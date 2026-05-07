# Agent Workplan — 跨会话工作记录

**用途**：让 Claude 下次进来不用重新对齐，直接 `Read` 这一份就能继续。
**最后更新**：2026-05-03
**当前阶段**：4 份设计文档完成，未开始实现。

---

## 项目最高目标

让 **幻灯片研习台** (learn.shc66.com) 同时达成 3 件事：
1. **产品**：质量超过当前 Qwen-VL-Max API、月 LLM 成本归零、延迟下降
2. **微调**：在 32GB 单卡上训出 Qwen3-VL-8B 自有模型替换 API
3. **论文**：BEA 2027 workshop（首选）/ AIED 2027 / EMNLP 2027 findings

---

## 已完成的 4 份设计文档（阅读顺序）

| 文档 | 内容 | 何时读 |
|---|---|---|
| `PRODUCT_PLAN.md` | 商业 / 合规 / 部署 | 已存在，给 supervisor 第一次会议看 |
| `docs/PROMPT_OPTIMIZATION_DESIGN.md` | API 模式下 prompt 改进 + 评估框架 | Tier A 改动是即刻性价比最高的事 |
| `docs/FINETUNE_DESIGN.md` | Qwen3-VL-8B 工程级微调（SFT→DPO→GRPO）| 整体路线 |
| `docs/PAPER_TRACK_DESIGN.md` | MayerGRPO + SlideRubric benchmark 论文方向 | 论文最终目标 |
| `docs/papers/README.md` | 16 篇下载论文索引 + rubric | 引文/方法依据 |

**论文 working title**: *MayerGRPO: Cognitively-Grounded Reward Decomposition for Distilling Educational VLMs*

---

## Claude 能交付清单（共 ~25 个 deliverable）

### A. 立即升级现有产品（不动模型，只改 prompt）
- [x] `backend/app/services/prompt_templates.py` 应用 Tier A+B 改动（防复读量化阈值 / sub_items≤4 / grounding-first / 口语化 / spatial contiguity / self_explanation_prompt） — 2026-05-03 完成
- [x] `backend/app/services/prompt_templates.py` 的 JSON schema 同步加 `grounding` 与 `self_explanation_prompt` 字段
- [x] `backend/app/services/dual_pipeline.py` 加 `_enforce_chunking_limit` 运行时防御（sub_items 自动截断）+ grounding 缺失日志

### B. 评估底座（所有 stage 共用）
- [ ] `tools/rubric_judge.py` — LLM-Rubric 7 维 judge（含完整 judge prompt）
- [ ] `tools/eval_quiz.py` — PresentAgent 5-题 quiz accuracy
- [ ] `tools/eval_retrieval.py` — MLP-style Recall@1/5
- [ ] `tools/eval_format.py` — JSON 解析成功率 + schema 合规
- [ ] `tools/eval_ab.py` — paired t-test 对比脚本

### C. 数据流水线
- [ ] `tools/data_harvest.py` — 从 production `llmusage` 表抽三元组
- [ ] `tools/data_synthesize.py` — 调 Qwen-VL-Max 生 K=4 candidates
- [ ] `tools/data_select.py` — 用 rubric 排序选 top-1，formatify Unsloth 格式
- [ ] `tools/data_dpo_pairs.py` — 构 (chosen, rejected) preference pairs

### D. 训练脚本
- [ ] `train/sft_qwen3vl.py` — Unsloth + QLoRA SFT
- [ ] `train/dpo_qwen3vl.py` — DPO trainer
- [ ] `train/grpo_mayer.py` — **MayerGRPO 完整实现**：5 个 reward components + GRPO trainer
- [ ] `train/configs/*.yaml` — 各阶段超参数

### E. MayerGRPO 5 个 reward 函数
- [ ] `rewards/r1_coherence.py` — n-gram 复读 + 离题实体
- [ ] `rewards/r2_chunking.py` — items / sub_items / 字数程序化检查
- [ ] `rewards/r3_signaling.py` — 双语术语 + highlight 数量
- [ ] `rewards/r4_grounding.py` — 视觉接地（VLM-judge）
- [ ] `rewards/r5_self_explanation.py` — metacognitive 问题分类
- [ ] `rewards/aggregate.py` — 加权汇总 + format penalty

### F. SlideRubric Benchmark
- [ ] `benchmark/collect_cc_slides.py` — 自动下载 OCW / Coursera CC slides
- [ ] `benchmark/source_list.md` — 100→300 slides 来源清单（URL + license 标注）
- [ ] `benchmark/annotation_handbook.md` — 标注者手册（7 维 rubric 详细判据）
- [ ] `benchmark/quiz_generation.py` — Claude-3.7 出 5×N 道题 + 审核 checklist
- [ ] `benchmark/concept_extraction.py` — concept ground truth 抽取
- [ ] `benchmark/release.py` — 打包发 HuggingFace Datasets

### G. 部署
- [ ] `serve/vllm_qwen3vl.py` — vLLM 推理端配置
- [ ] `backend/app/services/model_gateway.py` 改造 — 加 `LOCAL_VLM_URL` 灰度切流
- [ ] AWQ / GPTQ 量化导出脚本

### H. 论文产出
- [ ] `paper/main.tex` — ACL/EMNLP 格式骨架
- [ ] `paper/sections/related_work.tex` — 起草（引用已下载 16 篇）
- [ ] `paper/sections/method.tex` — MayerGRPO 完整数学描述 + reward equations
- [ ] `paper/sections/experiments.tex` — 实验设计章节
- [ ] `paper/figures/plot_results.py` — 主结果图表生成脚本
- [ ] `paper/abstract.tex` — 时刻校准方向用

### I. Supervisor 协作素材
- [ ] `supervisor/pitch_1pager.md` — 给老板第一次会用
- [ ] `supervisor/biweekly_template.md` — 双周进度报告
- [ ] `supervisor/irb_application.md` — 30 人 human eval IRB 模板

---

## User 必须自己做的

- [ ] **跑训练**（你的 32GB GPU）
- [ ] **下载 CC slides**（我给清单 + 自动脚本，你执行）
- [ ] **30 人 human eval 招募**（PolyU 同学群发 + ¥50 奖励）
- [ ] **投稿 / rebuttal**（你 + supervisor）
- [ ] **production DB 暴露给 harvest 脚本**（给我连接信息或你跑脚本）

---

## 推荐执行顺序（下次直接从 1 开始）

| # | 任务 | 工作量 | 阻塞依赖 |
|---|---|---|---|
| 1 | `prompt_templates.py` Tier A 升级 + diff 审核 | 1-2h | 无 |
| 2 | `tools/rubric_judge.py`（评估底座） | 2-3h | 无 |
| 3 | `tools/data_harvest.py` + 跑一次抽 1000 条看分布 | 2h | user 给 DB 路径 |
| 4 | `benchmark/source_list.md` v0.1（100 张 CC slides） | 3-4h | 无 |
| 5 | `tools/data_synthesize.py` + `data_select.py` | 3h | 步骤 2 完成 |
| 6 | `train/sft_qwen3vl.py` 完整脚本 | 2h | 步骤 5 跑出 SFT 数据 |
| 7 | `tools/eval_quiz.py` + `eval_retrieval.py` + `eval_format.py` | 4h | 无 |
| 8 | `rewards/r1~r5` 5 个 reward 实现 | 6-8h | 步骤 4 benchmark 雏形 |
| 9 | `train/grpo_mayer.py` MayerGRPO trainer | 4-6h | 步骤 8 完成 |
| 10 | `paper/main.tex` 骨架 + abstract + related work 起草 | 4h | 无 |

第 1-4 步可以先做，相对独立，能立刻产生价值。

---

## 重要约束 / 偏好（来自 user 的 CLAUDE.md 和过往对话）

1. **Simplicity first**：每次只交付 1-2 个 deliverable，别一次塞 10 个
2. **Surgical changes**：改现有文件优先于新建
3. **不要 mock**：production 代码不要写假数据 fallback
4. **Karpathy 准则**：少写注释、不要过度抽象、每行改动都能追溯到具体需求
5. **数据隐私**：student PPT 内容不要上 Anthropic / 不要外发；仅用作本地训练
6. **报告格式**：诊断和报告要先写"操作建议"在最前
7. **无外部 API 依赖（除 Qwen-VL-Max 和评估时的 GPT-4o）**

---

## 关键决策记录（已确定，不再讨论）

- ✅ **Base model**：Qwen3-VL-8B-Instruct（不是 32B、不是 InternVL）
- ✅ **训练栈**：Unsloth + TRL + QLoRA r=64
- ✅ **三阶段**：SFT → DPO → MayerGRPO（每阶段都有 off-ramp，质量够就停）
- ✅ **不做 inference-time critic agent**：dual_pipeline 已经是 multi-agent
- ✅ **目标会议**：BEA 2027 workshop 首选
- ✅ **核心 contribution**：5-component verifiable reward 根植 Mayer/Sweller/Chi
- ✅ **必须自建 benchmark**：SlideRubric (300 CC slides)，否则无 paper
- ✅ **复用 autoresearch 基础设施**（见下节）

---

## 与 autoresearch / autoresearch-meta 的协同

User 同时在做 autoresearch-meta 论文（target COLM/NeurIPS 2026, supervisor 同 LOU Wei, 已部署 AutoDL）。
**MayerGRPO 直接复用三件事**：

### 1. AutoDL + vLLM 基础设施
- 现有：`/root/autodl-tmp/` 跑通了 Qwen3-32B-AWQ + vLLM + HF mirror（hf-mirror.com）
- 复用方式：
  - **Qwen3-32B-AWQ → MayerGRPO 的 Rubric Judge**（不用再开 GPT-4o API 钱）
  - **Qwen3-VL-8B 微调放同一台 AutoDL**（错峰 / 多卡）
  - 直接借用 `run_experiment.sh` 的 vLLM 启停 + 健康检查模式

### 2. Prompt Auto-Tuning（autoresearch loop 改造）
把 autoresearch 的 5-min agent-edit-eval 循环改造成 **prompt 自动迭代**：
- `train.py` → 替换为 `eval_prompt.py`（跑 50 张 benchmark slide）
- agent 编辑对象 → `prompt_templates.py`
- metric `val_bpb` → `rubric_avg` / `quiz_acc`
- 一晚 8h ≈ 100 个 prompt 变体
- 这是 paper 里"prompt-only baseline"的强化版

适配工作：1 天，几乎所有基础设施现成。

### 3. Evaluator Integrity Hashing
直接抄 `runner.py` 的 `compute_file_hash` 模式到 MayerGRPO：
- Hash 5 个 reward 函数文件
- GRPO loop 每 N step verify 一次，防 reward leakage
- 论文里写"evaluator integrity guarantee"，是 reviewer 喜欢的细节

### ⚠️ 不要套用的
- autoresearch-meta 的"agent 完全无监督跑 architecture search" 不适用 MayerGRPO（频率不对、是 single-objective fine-tune 不是搜架构）
- 仅 LoRA hyperparam search 阶段（10-15 min mini-run）可以用

### 论文层互引（两篇互相加强 novelty，supervisor 同人，署名顺畅）
- MayerGRPO Related Work 引 autoresearch-meta：autonomous research methodology
- autoresearch-meta 反向引 MayerGRPO：domain-specific instantiation
- 路径：双线推进，一篇先发支撑另一篇

### 添加到 deliverable 清单
- [ ] `tools/prompt_autotune/` — autoresearch loop fork 改造为 prompt search（步骤 1.5，加在 #1 之后）
- [ ] `tools/integrity_hash.py` — reward 文件 hash 校验（在步骤 8 时同步加）
- [ ] `infra/autodl_setup.md` — AutoDL 上同时跑 32B-AWQ judge + 8B-VL 训练的部署 SOP

---

## 跨会话恢复指令（给下次的 Claude）

```
1. 读这份 AGENT_WORKPLAN.md（你在的文档）
2. 读 docs/PAPER_TRACK_DESIGN.md（最高方向）
3. 读 docs/FINETUNE_DESIGN.md（工程路径）
4. 看 user 这次想要哪个 deliverable，按"推荐执行顺序"表往下做
5. 完成后回来 update 这份文档的 [ ] 为 [x]
```

---

## 进度跟踪

| 日期 | 完成 deliverable | 备注 |
|---|---|---|
| 2026-05-03 | 4 份设计文档 + 16 篇论文下载 + NotebookLM 入库 | 阶段 0 完成 |
| 2026-05-03 | #1 prompt_templates.py v2 升级（Tier A+B 全套）+ dual_pipeline 防御 | +44 行 diff，编译通过、smoke test 通过；待 production 灰度验证 |
| | | |
