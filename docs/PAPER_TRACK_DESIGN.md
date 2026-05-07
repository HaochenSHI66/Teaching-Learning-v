# Paper-Track Design — 超越 Qwen-VL-Max + 可发表

**日期**：2026-05-03
**目标会议**：BEA 2027 workshop（首选）/ AIED 2027 / EMNLP 2027 findings（冲刺）
**升级自**：`FINETUNE_DESIGN.md` Stage 1+2+3 路径

---

## TL;DR

要"既超越 Max 又发表"，光做 SFT+DPO+naive GRPO 不够。论文需要一个**清楚的方法贡献**。

我提议的 paper positioning：

> **MayerGRPO**: 把 Mayer 多媒体学习理论拆成 5 个**程序化可验证的 sub-reward**，
> 用 GRPO 训一个 8B 小 VLM，在自建 benchmark 上**逼近或超越 Qwen-VL-Max**。

3 个贡献（任一独立都不够强，**组合起来 BEA workshop 稳，EMNLP findings 有机会**）：

1. **SlideRubric** — 公开 benchmark：300 slides × 7-dim rubric × 5 quiz × retrieval task，植根 CTML
2. **MayerGRPO** — 教育心理学根基的 5-component verifiable reward decomposition
3. **Empirical** — Qwen3-VL-8B + MayerGRPO 在 SlideRubric 上 ≥ Qwen-VL-Max；显著优于 naive GRPO baseline

---

## 1. 为什么 naive 路线发不了 paper

| naive 路径 | 论文审稿人会说 |
|---|---|
| "我们 SFT/DPO 了 Qwen3-VL-8B" | "工程报告，没有方法贡献" |
| "我们用 GPT-4o 当 judge 做 GRPO" | "judge-LLM-as-reward 已经被研究透了，且容易 reward hacking" |
| "我们做了 PPT 讲解任务" | "PPTAgent 已经做了，differentiation 是什么？" |
| "我们用 LLM-Rubric 评估" | "LLM-Rubric 是别人 ACL'24 工作，你的贡献是什么？" |

**Reviewer's Q: What's new?** —— 你必须回答得了。

---

## 2. 论文核心贡献：MayerGRPO

### 2.1 关键洞察

现有 VLM RL 工作的 reward 大致分两派：
- **Verifiable rewards** (DeepSeek-Math/R1 风格)：correct answer / format compliance —— **不适用** open-ended generation
- **Judge-LLM rewards**：让 GPT-4o 打分 —— **可解释性差、易 hacking、贵**

教育领域的"好讲解"不是 0/1 verifiable，但**也不是纯主观**。Mayer/Sweller 的理论给出了**可观测信号**：
- Coherence 是否被违反 → 看 explanation 与 slide 文本的复读率
- Chunking 是否合规 → 看 items / sub_items 数量分布
- Signaling 是否到位 → 看术语标注密度
- Grounding 是否成立 → 看 claims 与 visual elements 的对应

→ **把"教育心理学"翻译成 5 个可计算函数**，作为 GRPO 的 reward decomposition。这是新的，可发表。

### 2.2 5-Component Reward 详细设计

每个 component 输出 [0, 1]，最终 r = Σ wᵢ · rᵢ。

#### r₁ — Coherence (Mayer Coherence Principle，可程序化)
> "People learn more deeply when extraneous material is excluded"

```python
def r_coherence(generation, slide_ocr_text):
    # 1. 复读惩罚：n-gram overlap with slide
    bigrams_gen = ngrams(generation, 2)
    bigrams_slide = ngrams(slide_ocr_text, 2)
    redundancy = len(bigrams_gen & bigrams_slide) / max(len(bigrams_gen), 1)
    
    # 2. 离题惩罚：generation 中提到但 slide 上没有的实体
    gen_entities = extract_entities(generation)
    slide_entities = extract_entities(slide_ocr_text + slide_vision_extract)
    off_topic = len(gen_entities - slide_entities) / max(len(gen_entities), 1)
    
    return 1.0 - 0.6 * redundancy - 0.4 * off_topic
```

依据：Mayer 2014 Cambridge Handbook Ch.12 Coherence Principle。

#### r₂ — Chunking (Sweller CLT，完全程序化)
> Working memory limited to 3-4 active chunks

```python
def r_chunking(generation_json):
    items = generation_json["items"]
    n_items = len(items)
    
    # 一级 item 数量 ∈ [4, 8]
    item_score = 1.0 if 4 <= n_items <= 8 else max(0, 1 - 0.3 * abs(n_items - 6))
    
    # 每个 item 的 sub_items ≤ 4
    sub_violations = sum(1 for it in items if len(it.get("sub_items", [])) > 4)
    sub_score = 1.0 - 0.25 * sub_violations
    
    # 单 item 字数 ≤ 80
    length_score = mean([1.0 if len(it["explanation"]) <= 80 else 
                         max(0, 1 - 0.01 * (len(it["explanation"]) - 80))
                         for it in items])
    
    return (item_score + sub_score + length_score) / 3
```

依据：Sweller 1994 Cognitive Load Theory。

#### r₃ — Signaling (Mayer Signaling，半程序化)
> "Cues that highlight the organization of essential material"

```python
def r_signaling(generation_json):
    # 术语首次出现是否标注 **中文 (English)**
    bilingual_terms = count_bilingual_pattern(generation_json)
    expected = 3  # 每页 3-6 个
    term_score = min(1.0, bilingual_terms / expected)
    
    # 是否有 highlight（每页 0-2 个，过多过少都扣）
    highlights = count_highlights(generation_json)
    hl_score = 1.0 if 1 <= highlights <= 2 else 0.5
    
    return 0.5 * term_score + 0.5 * hl_score
```

依据：Mayer Signaling Principle。

#### r₄ — Grounding (Grounded CoT，半程序化)
> Each claim must be traceable to a visual element

```python
def r_grounding(generation_json, slide_image):
    # 要求模型输出 grounding 字段：visual_elements + spatial_layout
    claims = extract_claims(generation_json)  # 每个 item.explanation 中的事实陈述
    visual_elements = generation_json.get("grounding", {}).get("visual_elements", [])
    
    # 用 VLM (separate frozen reward judge) 判定每个 claim 是否对应一个 visual_element
    grounded = vlm_check_grounding(claims, visual_elements, slide_image)
    return grounded / max(len(claims), 1)
```

依据：Grounded CoT (arXiv 2503.12799)、M3ID (CVPR 2024)。

#### r₅ — Self-Explanation (Chi，judge-LLM 兜底)
> Generative why/how prompts

```python
def r_self_explanation(generation_json):
    # 程序化：是否存在 self_explanation_prompt 字段且非空
    sep = generation_json.get("self_explanation_prompt", "")
    if not sep: return 0.0
    
    # judge：问题是 metacognitive (why/how) 而非 factual recall (what/who)
    # 这一项必须用 judge LLM 做，但题目已收敛到 1 个简单分类问题，hacking 难度高
    is_metacognitive = judge_metacognitive(sep)  # 0 or 1
    is_grounded_in_slide = judge_grounded(sep, slide_text)  # 0 or 1
    return 0.5 * is_metacognitive + 0.5 * is_grounded_in_slide
```

依据：Chi 1989/1994 Self-Explanation Effect。

#### 权重
```python
total_reward = 0.2 * r_format + 0.25 * r_coherence + 0.20 * r_chunking + \
               0.15 * r_signaling + 0.15 * r_grounding + 0.05 * r_self_explanation
```

权重在论文里要做 **ablation**：均匀权重 vs 优化权重 vs 单 component。

### 2.3 为什么这是 publishable 的

- **Verifiable + Interpretable**：4/5 是程序化的，比纯 judge-LLM 抗 hacking
- **Theory-grounded**：每个 component 有教育心理学经典依据，不是凭空设计
- **Decomposable**：审稿人能 ablate（去掉 r_chunking 看 chunking 维度跌多少）
- **Generalizable**：方法论可推广到任何"教学解释"任务（textbook、视频、tutoring）

---

## 3. SlideRubric Benchmark（contribution #1）

### 3.1 为什么单独发布 benchmark 重要

现有相关 benchmark：
- **MLP** (2022) — slide ↔ spoken explanation，但无 rubric / 无 quiz
- **PPTEval** (2025) — 评 PPT 生成，不是讲解
- **MRBench (BEA 2025)** — AI tutor 对话，不是 slide-grounded

→ **slide-to-explanation 没有 standard benchmark**。你建一个，论文价值 +1。

### 3.2 SlideRubric 构成

| 资产 | 数量 | 来源 |
|---|---|---|
| Slides | **300** | 公开课程材料 + Creative Commons (避免版权问题) |
| 学科覆盖 | 5 | CS / 数学 / 物理 / 经济 / 生物 |
| Page-type 标签 | 6 | title / toc / intro / content / example / summary |
| 难度分级 | 3 | easy / medium / hard |
| Reference explanations | 300 | 人工 + Qwen-VL-Max + Claude-3.7 三方对照 |
| Multiple-choice quiz | 1500（5 题×300） | Claude-3.7 出 + 人工审 |
| 7-dim rubric annotations | 300×7 | 3 个标注者 + Krippendorff α≥0.7 |
| Concept ground truth | 300 sets | 人工抽 |

**版权关键**：必须 Creative Commons 或公开课件（OCW、Coursera 公开课、教师自愿提供）。**不能用任何 PolyU 内部材料**，否则发不了。

### 3.3 评估三件套

| 任务 | 协议 | 主指标 |
|---|---|---|
| **Rubric Scoring** | LLM-Rubric judge 7 题 1-4 分 | mean per-dim score |
| **Quiz Accuracy** | evaluator VLM 答 5 题（输入 slide+explanation） | acc ∈ [0, 1] |
| **Retrieval** | CLIP/Qwen-VL 把讲解 embed，对 300 slides 检索 | Recall@1, R@5, R@10 |

---

## 4. 实验设计（empirical contribution #3）

### 4.1 Baseline 阵容（必须强）

| Model | 类型 | 角色 |
|---|---|---|
| **Qwen-VL-Max** | 闭源 API | 你要超越的目标 |
| **GPT-4o** | 闭源 API | commercial frontier |
| **Claude-3.7-Sonnet** | 闭源 API | commercial frontier，强 vision |
| **Qwen3-VL-32B** | 开源大模型 | 参数量上限对照 |
| Qwen3-VL-8B (zero-shot) | 你的底座 | 训练前基线 |
| Qwen3-VL-8B + SFT | ablation | "RL 有用吗" |
| Qwen3-VL-8B + DPO | ablation | "GRPO 比 DPO 好吗" |
| Qwen3-VL-8B + naive GRPO | **关键 baseline** | 用 GPT-4o 当 single judge reward |
| **Qwen3-VL-8B + MayerGRPO** | **ours** | |
| Qwen3-VL-8B + MayerGRPO (no r_coherence) | ablation | 去掉 r₁ 看 coherence 跌多少 |
| Qwen3-VL-8B + MayerGRPO (no r_chunking) | ablation | |
| ... 类似 5 个 leave-one-out ablation | | |

### 4.2 主结果表（论文 Table 1 模板）

```
                        | Rubric Avg | Quiz Acc | R@1  | Cost/page
------------------------|-----------|----------|------|----------
Qwen-VL-Max (API)       |  3.4      |  0.66    | 0.78 | ¥0.02
GPT-4o                  |  3.5      |  0.69    | 0.81 | ¥0.04
Claude-3.7-Sonnet       |  3.6      |  0.72    | 0.83 | ¥0.05
Qwen3-VL-32B (zero)     |  3.2      |  0.62    | 0.74 | local
Qwen3-VL-8B (zero)      |  2.9      |  0.55    | 0.68 | local
Qwen3-VL-8B + SFT       |  3.3      |  0.64    | 0.76 | local
Qwen3-VL-8B + DPO       |  3.4      |  0.66    | 0.78 | local
Qwen3-VL-8B + naive GRPO|  3.3*     |  0.64    | 0.74 | local  ← reward hacked
Qwen3-VL-8B + MayerGRPO |  3.6      |  0.71    | 0.82 | local  ← OURS
```
（数字是预期，等实验 ✅）

* naive GRPO 注脚：rubric 看似涨但 quiz 跌，说明在 game judge —— 这个对照非常重要，是 paper 的 punch line。

### 4.3 Human Evaluation（必须有）

- 30 PolyU 学生（招募、提供 HK$50 奖励）
- 每人评 20 张 slide：盲对比 ours vs. 4 个 baseline 的 explanation
- 评 5 维（清晰度 / 准确度 / 帮助度 / 易读性 / 信任度）1-5 Likert
- 报 pairwise win-rate + Kendall's W (rater agreement)

**IRB**：PolyU CS 系这种小规模学生研究通常有快速 IRB 流程，准备 1 页 application 就够。

### 4.4 失败案例分析（**审稿人必看**）

挑 ~10 个 ours 表现差的 slide，分类失败模式：
- 视觉过于稠密（图表叠加）
- 公式 OCR 错误传播
- 学科知识不足（生物术语模型不熟）

→ 论文 Section 6 写好这个，叫 reviewer "尊敬的审稿"。

---

## 5. 时间表（瞄准 BEA 2027，假设 deadline 2027 年 2 月）

| 月份 | 任务 | 产出 |
|---|---|---|
| **2026-05** | 文档完成 + 找 advisor | PolyU CS prof 一名 |
| 2026-05 ~ 06 | SlideRubric v0.1（100 slides 试跑） | benchmark 雏形 |
| 2026-06 | 数据 harvest + Qwen-VL-Max 蒸馏 + SFT 训练 | SFT model checkpoint |
| 2026-07 | DPO + 完整 SlideRubric 300 slides 标注 | benchmark v1.0 |
| 2026-08 | MayerGRPO 实现 + 主实验 + ablation | 主结果表 |
| 2026-09 | 多 baseline 跑评估 + Human eval IRB + 招募 | 全部数据 |
| 2026-10 | Human eval 数据收集 + 论文 draft v1 | 8 页 draft |
| 2026-11 | revise + 内部 review + 补实验 | 9 页 draft |
| 2026-12 | revise + 同行预读 | submission-ready |
| **2027-01 ~ 02** | **submit BEA 2027 / AIED 2027** | submission |
| 2027-03 ~ 04 | rebuttal | |
| 2027-05+ | accepted / 改投 EMNLP findings | |

**实际工作量评估**：每周 ~20-30h（你还要上学/工作），共 **9 个月** ≈ 180-270h。这是 solo 学生项目的真实 paper effort。如果有 advisor 一起 review 加速，可压到 6 个月。

---

## 6. 与之前文档的关系

| 文档 | 用于 | 何时读 |
|---|---|---|
| `PRODUCT_PLAN.md` | 产品 / 商业 / 部署 | 给 advisor 看你的产品落地能力 |
| `PROMPT_OPTIMIZATION_DESIGN.md` | 当前 API 模式的 prompt 改进 | 写 paper 的 ablation："prompt-only baseline" |
| `FINETUNE_DESIGN.md` | 工程级微调 | Stage 1+2 部分 = 论文里的 SFT 和 DPO baseline |
| **`PAPER_TRACK_DESIGN.md`** | **Stage 3 + benchmark + 论文** | **当前** |

→ 所有 4 个文档形成完整路径：**产品 → prompt 调优 → 微调上线 → 上升为论文工作**。

---

## 7. 你需要立即做的 4 件事（本周）

1. **找 advisor**：PolyU CS 做 NLP/AI for education / multimodal 的教授（不是必须 leader 级，副教授 / 助理教授就行）。MayerGRPO 这个 pitch 拿给他/她看。
2. **挑 100 张 CC-licensed slides 试跑 SlideRubric v0.1**：先跑通流水线再扩到 300。
3. **kaggle/HF 注册数据集账号**：benchmark 公开发布需要持久 host。
4. **看 BEA 2025 论文 3 篇**（在你 NotebookLM 里有 BEA 2025 shared task 那篇）：理解审稿口味、引用规范。

---

## 8. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 找不到 advisor | 中 | 退化为 BEA workshop 单作者投（workshop 接受 single-author） |
| Qwen3-VL-8B + MayerGRPO 没超过 Max | 中 | 论文 reframe 成"matched performance with 1/X cost"，仍可发 |
| Reward hacking 严重 | 中 | 加 holdout judge + retrieval R@1 双锚定，naive GRPO 对照表本身就是"我们没 hack"的证明 |
| 版权（slides 来源） | 高 | 严格只用 CC / 公开课件 / 自己做的 slides |
| Human eval 招不到 30 人 | 中 | PolyU CS 课程同学 + 微信群 + ¥50 奖励通常够 |
| 时间不够（9 个月太紧） | 中 | 砍 ablation 数量；先投 BEA workshop 短文（4 页 + appendix） |

---

## 9. 论文预设标题与摘要（写在前面，时刻校准方向）

**Title (working)**:
> **MayerGRPO: Cognitively-Grounded Reward Decomposition for Distilling Educational Vision-Language Models**

**Abstract (placeholder, 150 words)**:
> Generating high-quality textual explanations for lecture slides requires balancing
> visual faithfulness, redundancy avoidance, and pedagogical structure—criteria that
> existing reinforcement learning approaches address either with hand-crafted format
> rewards or opaque judge-LLM signals. We propose **MayerGRPO**, a reward decomposition
> rooted in classical multimedia learning theory (Mayer, Sweller, Chi) that
> instantiates five verifiable sub-rewards: coherence, chunking, signaling, grounding,
> and self-explanation. We further release **SlideRubric**, the first multi-dimensional
> benchmark for slide-to-explanation generation, comprising 300 Creative-Commons
> slides across 5 disciplines with rubric, quiz-accuracy, and retrieval evaluation
> protocols. Fine-tuning Qwen3-VL-8B with MayerGRPO matches Qwen-VL-Max on rubric
> score (3.6 vs 3.4) and surpasses it on quiz accuracy (0.71 vs 0.66) at 1/Xx the
> inference cost. Ablations show that removing the cognitive-load chunking reward
> degrades quiz accuracy by Y%, validating the necessity of theory-grounded reward design.

→ **把这段话贴桌面**。每次做实验，问自己："这步能让这段 abstract 的哪个数字更扎实？"

---

## 附：核心引用（论文必引）

教育心理学：
- Mayer, R. E. (2014). *Cambridge Handbook of Multimedia Learning*, Ch. 12.
- Mayer, R. E. (2024). *The Past, Present, and Future of CTML*. Educational Psychology Review.
- Sweller, J. (1994). *Cognitive Load Theory, Learning Difficulty, and Instructional Design*.
- Chi, M.T.H. et al. (1989, 1994). Self-Explanation studies.

VLM / RL：
- DeepSeek-AI (2024). *DeepSeek-Math (GRPO)*.
- Qwen team (2025). *Qwen3-VL Technical Report*. arXiv 2511.21631.
- Faithful GRPO (2026). arXiv 2604.08476.
- S-GRPO (2026). arXiv 2604.16557.
- M3ID (CVPR 2024).
- Grounded CoT (2025). arXiv 2503.12799.

Educational benchmarks：
- Lee et al. (2022). *MLP Dataset*. arXiv 2208.08080.
- PPTAgent + PPTEval (2025). arXiv 2501.03936.
- PresentAgent (2025). arXiv 2507.04036.
- BEA 2025 Shared Task (Pedagogical Tutor Eval).

Reward modeling：
- LLM-Rubric (ACL 2024). arXiv 2501.00274.
- Rubric-based Reward Modeling (2025). arXiv 2509.21500.
- Concept Bottleneck Reward Models (2025). arXiv 2507.04695.
