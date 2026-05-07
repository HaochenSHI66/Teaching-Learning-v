# Finetune Design — 幻灯片研习台 专属 VLM

**日期**：2026-05-03
**算力前提**：单卡 32GB VRAM（≈ RTX 5090 / A6000 / RTX Pro 6000）
**目标**：把当前的 Qwen-VL-Max API 替换成自有微调小模型，**质量不退化、成本归零、延迟下降**。

---

## TL;DR

- **Base**：Qwen3-VL-8B-Instruct（QLoRA 微调，32GB 充裕）
- **路径**：SFT → DPO →（可选）GRPO，三阶段渐进
- **数据**：来源 1+2+3 = production logs + teacher distillation + rubric filtering
- **总耗时**：停在 SFT 7–9 天，全部跑完 ~3 周
- **总花费**：~¥400–500（全是 API 钱，电费不算）
- **不要做**：从头 RL、训独立 reward model、再加 inference-time critic agent —— 全是 over-engineering

---

## 1. Base Model 选型

| 候选 | 参数 | 32GB 训练显存 | 文档能力 | 是否推荐 |
|---|---|---|---|---|
| **Qwen3-VL-8B-Instruct** | 8B | ~14GB (Unsloth 4bit) | DocVQA SOTA 级 | ✅ **首选** |
| Qwen3-VL-4B | 4B | ~8GB | 弱 1 档 | 备选（质量不够时降级） |
| Qwen3-VL-32B | 32B | ~28GB（紧） | 最强 | ❌ 训练太慢、推理也慢 |
| InternVL3.5-8B | 8B | ~16GB | 相当 | ❌ 生态不如 Qwen，无法 fallback |
| MiniCPM-V 2.6 | 8B | ~14GB | 弱于 Qwen3-VL | ❌ |

**为什么 Qwen3-VL-8B**：
1. tokenizer / chat template 与你现在 production 的 Qwen-VL-Max 一致 → 同一套 prompt、同一套数据集都能复用
2. Qwen3-VL 多任务 pretrain 阶段就含 document、OCR、图表理解 —— 你的任务"先天匹配"
3. 256K context 原生支持 → 后续做"全文档讲解"也不用换底座
4. Unsloth 已支持 1.7× 加速、60% 显存削减 → 32GB 上能开 batch=4

---

## 2. 训练栈

| 组件 | 选型 | 理由 |
|---|---|---|
| 框架 | **Unsloth + TRL** | 1.7× 加速、Qwen3-VL 一类支持 |
| 量化 | **4-bit QLoRA (NF4)** | 8B 模型在 32GB 上必然路径 |
| LoRA | r=64, alpha=128, dropout=0.05 | target: 全部 attn + mlp + vision encoder |
| 优化器 | AdamW 8-bit | 与 Unsloth 默认匹配 |
| 调度 | cosine, warmup_ratio=0.03 | 标准 |
| 梯度检查点 | `use_gradient_checkpointing="unsloth"` | 省 30%+ 显存 |
| 部署量化 | AWQ 4-bit / GPTQ-Int4 | 推理时 ~6GB，2-3s/页 |

---

## 3. 数据策略（**这一节决定成败**）

### 3.1 三个数据来源

#### 来源 A — Production Logs（你已经有的金矿）
你后端的 `LLMUsage` 表已经记录每次 Qwen-VL-Max 调用：
- `image_path`、`prompt`、`response_json`、`page_num`、用户反馈（如有点赞/重生成）
- **无需任何额外 API 钱**
- 分布与真实用户一致
- 抽 5K-15K 条

```python
# tools/data_harvest.py 伪代码
SELECT image_path, prompt, response_json
FROM llmusage
WHERE endpoint = '/api/explanations/generate'
  AND http_status = 200
  AND created_at > NOW() - INTERVAL '90 days'
LIMIT 15000;
```

#### 来源 B — Teacher Distillation with Rubric Filtering
对每张 slide：
1. **K=4 candidates**：调 Qwen-VL-Max，temperature=0.8、top_p=0.95、随机种子 4 次
2. **Rubric 打分**：用之前设计的 7 题 LLM-Rubric（judge=GPT-4o 或 Qwen-VL-Max-自己）
3. **筛选**：取 7 维加权均分最高的 1 个作为 gold
4. **rejection rate**：实测 25-40% 的 slides 4 个 candidate 都不达标（avg<3.0）→ 丢弃

预计成本：3000 张 × 4 candidate × ~¥0.04 = **¥480**，judge 再 ~¥100 → 共 **~¥600**

#### 来源 C — 人工/同学审核黄金集（仅 dev/test）
- 50-100 张困难页（含表格、公式、代码、图表）
- 你 + 1-2 个同学手工写 reference output
- **不进训练集**，用作最终评估的 holdout

### 3.2 数据量目标

| Stage | 量 | 说明 |
|---|---|---|
| SFT | 3000-8000 例 | 结构化任务"少而精">"多而杂" |
| DPO | 1500-3000 pairs | 来自 SFT 模型自己 sample，rubric 排序构造 (chosen, rejected) |
| GRPO | 在线 rollout | 不需要预先准备 |

### 3.3 数据格式（Unsloth Qwen3-VL 标准）

```json
{
  "messages": [
    {"role": "system", "content": "<同 prompt_templates._OUTLINE_PROMPT_CORE>"},
    {"role": "user", "content": [
      {"type": "image", "image": "/path/to/slide.png"},
      {"type": "text", "text": "<上下文 + 提取文本>"}
    ]},
    {"role": "assistant", "content": "<gold JSON>"}
  ]
}
```

---

## 4. 三阶段训练管线

### Stage 1 — SFT（必做）

```python
from unsloth import FastVisionModel
from trl import SFTTrainer

model, tokenizer = FastVisionModel.from_pretrained(
    "unsloth/Qwen3-VL-8B-Instruct-bnb-4bit",
    load_in_4bit=True,
    use_gradient_checkpointing="unsloth",
)
model = FastVisionModel.get_peft_model(
    model,
    r=64, lora_alpha=128, lora_dropout=0.05,
    finetune_vision_layers=True,    # 让 vision encoder 也学一点
    finetune_language_layers=True,
    target_modules="all-linear",
)

trainer = SFTTrainer(
    model=model, tokenizer=tokenizer,
    train_dataset=ds,
    args=SFTConfig(
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,   # effective batch = 16
        num_train_epochs=2,
        learning_rate=2e-4,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        bf16=True,
        max_length=8192,
    ),
)
trainer.train()
```

- **时长**：5K 样本 × 2 epoch ≈ **8-12h**（单 32GB）
- **off-ramp ✋**：跑完评估，若 **LLM-Rubric ≥3.3 / 4 + Quiz Acc ≥0.6** → **直接停**，部署上线。多数情况这就够了。

### Stage 2 — DPO（可选，建议做）

#### 数据构造
- 用 SFT 模型对 holdout 之外的 1500 张 slide，每张 sample K=4
- Rubric 排序 → 取 (top-1, bottom-1) 组成 (chosen, rejected) pair
- 过滤掉 chosen-rejected gap < 0.5（learning signal 太弱）

#### 训练
```python
from trl import DPOTrainer
trainer = DPOTrainer(
    model=sft_model,
    ref_model=None,  # Unsloth 自动创建
    args=DPOConfig(beta=0.1, ...),
    train_dataset=pref_ds,
)
```

- **时长**：~4-6h
- **off-ramp ✋**：若 **Rubric ≥3.6 / Quiz Acc ≥0.7** → 停。

### Stage 3 — GRPO（实验性，做了能上简历/论文）

**何时做**：SFT+DPO 已经做完、还想再压榨 5-10% 质量、且能接受 1-2 周折腾。

#### Reward 设计（不要 reward model，用 verifiable rewards）

```python
def compute_reward(slide_image, generated_json) -> float:
    # 1. 格式分（程序化，0 或 1）
    try:
        parsed = json.loads(generated_json)
        format_ok = (
            "items" in parsed and "concepts" in parsed
            and 1 <= len(parsed["items"]) <= 8
            and all(len(it.get("sub_items", [])) <= 4 for it in parsed["items"])
        )
    except: format_ok = False
    r_format = 1.0 if format_ok else 0.0

    # 2. Rubric 分（judge LLM 跑 7 题 → 归一化到 [0,1]）
    rubric_scores = call_judge_llm(slide_image, generated_json)  # 7 个 1-4 分
    r_rubric = (sum(rubric_scores) - 7) / 21  # 7→0, 28→1

    # 3. Concept recall（程序化）
    pred_concepts = {c["name_en"].lower() for c in parsed.get("concepts", [])}
    gold_concepts = get_gold_concepts(slide_image)  # 来自人工集 / 高分 candidates
    r_concept = len(pred_concepts & gold_concepts) / max(len(gold_concepts), 1)

    return 0.2 * r_format + 0.6 * r_rubric + 0.2 * r_concept
```

#### GRPO config
- `group_size = 8`（DeepSeek 推荐）
- `kl_coef = 0.04`
- `learning_rate = 5e-6`
- `max_steps = 1500`
- 时长：**3-7 天**

#### ⚠️ Reward Hacking 防护
- 必须用**独立的 holdout judge**（与训练时 judge 不同模型）做最终评测
- 监控：rubric score 飙升但 retrieval R@1 不涨 = 模型在 game judge

---

## 5. Multi-Agent 角色澄清

你现在的 `dual_pipeline.py`（视觉提取 + 文本讲解）**已经是 multi-agent**。微调后保持双阶段即可，**不要再加 agent**。

可能的诱惑（**都不推荐**）：
- ❌ Inference-time Critic：增 100% 推理成本换 5% 质量，不划算（SFT/DPO 已经把 critic 能力 internalize）
- ❌ Refiner Agent：DPO 已经在做这件事
- ❌ Tool-use Agent：你这个任务不需要外部工具

**真要做 multi-agent，唯一值得的**：
- ✅ **训练数据生成阶段** 用 Generator + Critic 多智能体合作（OmniThoughtV、DistilQwen-ThoughtX 都这么做） —— 这就是上面 3.1 B 的 rubric filtering，已经包含了

---

## 6. 评估（复用 PROMPT_OPTIMIZATION_DESIGN.md 第三章框架）

每个 stage 训完都跑同一套：

| 指标 | 工具 | 通过线 |
|---|---|---|
| LLM-Rubric 7 维均分 | `tools/eval_rubric.py` | ≥3.3（SFT）/ ≥3.6（DPO）/ ≥3.8（GRPO） |
| Quiz Accuracy | `tools/eval_quiz.py` | ≥0.6 / ≥0.7 / ≥0.75 |
| Retrieval R@1 | `tools/eval_retrieval.py` | ≥0.7 / ≥0.8 / ≥0.85 |
| JSON 解析成功率 | `tools/eval_format.py` | ≥0.98（任何 stage） |
| 与 Qwen-VL-Max 配对 t 检验 | `scipy.stats.ttest_rel` | p<0.05 不显著差 |

---

## 7. 成本时间表

| 阶段 | 时间 | API 费 | 备注 |
|---|---|---|---|
| 数据 A: 抽 production logs | 0.5 天 | ¥0 | 已有数据 |
| 数据 B: Teacher distillation 4 candidates × 3000 | 2 天 | ~¥480 | Qwen-VL-Max 调用 |
| 数据 B: Rubric judge | 1 天 | ~¥100 | 7 题 × 3000 |
| 数据 C: 人工 50 张 reference | 1 天 | ¥0 | 你 + 同学 |
| **Stage 1 SFT 训练** | 0.5-1 天 | 电费 | 8-12h |
| Stage 1 评估 | 0.5 天 | ~¥50 | judge API |
| **小计：停在 SFT** | **~6-8 天** | **~¥630** | 推荐起点 |
| Stage 2 DPO 数据 + 训练 | 2 天 | ~¥80 | |
| Stage 2 评估 | 0.5 天 | ~¥50 | |
| **小计：停在 DPO** | **+ 2.5 天 = ~10 天** | **+¥130 = ~¥760** | 性价比最优 |
| Stage 3 GRPO | 5-7 天 | ~¥80 | judge API rollout |
| Stage 3 评估 | 1 天 | ~¥80 | 含 holdout judge |
| **全程跑完** | **~17-19 天** | **~¥920** | 论文/简历级 |

---

## 8. 部署后对比

|   | 当前（Qwen-VL-Max API） | 微调后 Qwen3-VL-8B（自托管） |
|---|---|---|
| 单页讲解 token 成本 | ~¥0.02 | 电费可忽略 |
| 50 用户 × 200 页/月 | ~¥200/月 | ¥0 |
| P50 延迟 | 网络 3-8s | 本地 2-3s（vLLM serving） |
| 限流风险 | DashScope 配额 | 自有，无 |
| 隐私 | 学生 PPT 上传到阿里云 | 完全本地 |
| 改 prompt 试错成本 | 每次 API | 零成本 |

→ **这是 PRODUCT_PLAN.md 里那个"~¥200/月 LLM 费用"问题的根本解** —— 不要靠加 quota / 收费，直接换自有模型。

---

## 9. 决策树

```
你的目标？
│
├─ 只想省钱、产品能跑就行
│   └─ Stage 1 SFT (~7 天, ¥630)
│      预期：质量与 Max 持平 ±5%、月省 ¥200
│
├─ 想质量再上一档
│   └─ Stage 1 + Stage 2 DPO (~10 天, ¥760)
│      预期：超越 Max 0-5%（在你的特定任务上）
│
└─ 想做 capstone / 论文 / 求职亮点
    └─ Stage 1 + 2 + 3 GRPO (~3 周, ¥920)
       亮点话术："Rubric-conditioned GRPO for educational VLM；
                 在 50-slide benchmark 上 Quiz Acc 从 0.64 → 0.78"
```

---

## 10. Phase 1 落地 Checklist（SFT 路径）

按顺序：

- [ ] 写 `tools/data_harvest.py` — 从 `llmusage` 表抽三元组到 jsonl
- [ ] 写 `tools/data_synthesize.py` — 调 Qwen-VL-Max API 生 K=4 candidates
- [ ] 写 `tools/rubric_judge.py` — 7 题 LLM-Rubric → score json
- [ ] 写 `tools/data_select.py` — 按 rubric 选 top-1，formatify Unsloth 格式
- [ ] 抽 50 张人工 reference（dev set）
- [ ] 写 `train/sft_qwen3vl.py` — Unsloth + QLoRA 训练脚本
- [ ] 写 `tools/eval_rubric.py` / `eval_quiz.py` / `eval_retrieval.py`
- [ ] 跑训练 + 评估
- [ ] 量化导出 AWQ → 写 `serve/vllm_qwen3vl.py` 启 vLLM 端口
- [ ] 后端 `model_gateway.py` 加 `LOCAL_VLM_URL` env 切流，灰度 10% → 50% → 100%

---

## 附：关键参考

**模型 / 工具**：
- [Qwen3-VL Technical Report (arXiv 2511.21631)](https://arxiv.org/abs/2511.21631)
- [Unsloth Qwen3-VL 微调指南](https://unsloth.ai/docs/models/qwen3-vl-how-to-run-and-fine-tune)
- [Kaitchup: Qwen3-VL-8B VRAM 实测](https://kaitchup.substack.com/p/qwen3-vl-fine-tuning-on-your-computer)
- [DataCamp: Fine-Tuning Qwen3-VL 8B 教程](https://www.datacamp.com/tutorial/fine-tuning-qwen3-vl-8b)

**方法 / 论文**：
- [GRPO 原始论文 (DeepSeek-Math)](https://arxiv.org/abs/2402.03300)
- [Faithful GRPO for VLMs (arXiv 2604.08476)](https://arxiv.org/html/2604.08476)
- [S-GRPO: Unified Post-Training for VLMs (arXiv 2604.16557)](https://arxiv.org/html/2604.16557)
- [Rubric-based Reward Modeling (arXiv 2509.21500)](https://arxiv.org/html/2509.21500v3)
- [DistilQwen 工业实践 (arXiv 2504.15027)](https://arxiv.org/html/2504.15027v1)
- [easydistill 工具包](https://github.com/modelscope/easydistill)

**配套已下载论文**（`docs/papers/`）：
- 06 LLM-Rubric — judge 设计基础
- 02 PPTAgent / 03 PresentAgent — 评测协议来源
- 07 Grounded CoT / 08 M3ID — 反幻觉 reward 信号设计
