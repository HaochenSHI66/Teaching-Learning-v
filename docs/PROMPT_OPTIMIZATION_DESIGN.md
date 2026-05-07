# Prompt Optimization Design — 幻灯片研习台

**作者**：基于 NotebookLM × 16 篇论文综合
**日期**：2026-05-03
**对标的当前代码**：`backend/app/services/prompt_templates.py`（517 行，`_OUTLINE_PROMPT_CORE` + JSON 变体 + ROI + Vision 提取）

---

## TL;DR

你现在的 prompt 已经做对了 70% 的事情 —— 段落分块、术语中英、按顺序讲解、避免复读、特殊页面分流（title/toc）。

差距在 4 个地方：
1. **缺显式视觉接地步骤** —— 模型可能凭语言先验臆造 slide 内容（Grounded CoT / M3ID 都警告过）
2. **缺自我解释机制** —— 只讲"是什么"，不引导学生去想"为什么"（Chi 1989/1994）
3. **CLT 分块规则没量化到 sub_items 层** —— 当前只规定一页 2-3 个一级 item，但单个 item 的 sub_items 没限上限
4. **没有自动评估框架** —— 现在改 prompt 全靠肉眼，无法量化"v2 比 v1 好"

下面给出**最小侵入式的改动方案** + **完整评估框架**，分 3 个 phase 落地。

---

## 一、当前 prompt 的 Gap 分析

| Mayer / 教育心理学原则 | 论文定义 | 当前 `_OUTLINE_PROMPT_CORE` 是否覆盖 | 改动建议 |
|---|---|---|---|
| **Coherence**（去无关内容） | "people learn more deeply when extraneous material is excluded" | ✅ 已有"⚠️ 只讲页面上有的内容" | 保持 |
| **Signaling**（信号/重点） | "cues that highlight the organization of essential material" | ✅ 加粗 + ==高亮== 双工具职责清晰 | 保持 |
| **Redundancy**（不复读） | "graphics + narration > graphics + narration + on-screen text" | ⚠️ 只有"解释要增加价值——不是用更花哨的中文复述原文"，约束偏弱 | **加强**：在禁止事项里明确写"严禁原句复读 PPT 文字 ≥10 字" |
| **Segmenting**（用户自定步分块） | "user-paced segments rather than continuous unit" | ✅ 一页 2-3 个 item，长度紧凑 | 保持 |
| **Modality**（口语 vs 文字） | "graphics + narration > graphics + on-screen text" | ❌ 没有"口语化"指令 | **新增**："写得像老师在白板边讲，不是教科书段落" |
| **Spatial Contiguity**（图文邻近） | 解释要点名图上具体位置 | ⚠️ 没强制 | **新增**："涉及图表时点名位置（如'右侧蓝色趋势线'）" |
| **Pre-training**（先学术语） | 复杂关系前先定义概念 | ✅ "术语首次出现时写成 **中文 (English)**" | 保持 |
| **Personalization**（亲和语气） | 用 "you" / 对话式 > 第三人称 | ⚠️ 当前是中性陈述 | 看产品 UX 决定，不强制改 |
| **CLT 工作记忆 3-4 条**（Sweller） | 单次 chunk 不超过 3-4 项 | ⚠️ 一级限 2-3，但 `sub_items` 无上限 | **新增**："单 item.sub_items 不得超过 4 条" |
| **Self-Explanation**（Chi） | 提问触发学生生成性推理 | ❌ 完全没有 | **新增（实验）**：每 2-3 卡末尾选 1 个"思考问题" |
| **Grounded CoT**（视觉接地） | 先列 visual elements 再推理 | ❌ 没有 thinking 步骤 | **新增**：JSON 输出前加 `<grounding>` 块列出关键视觉元素 |
| **M3ID Anti-hallucination** | 短段生成抑制语言先验漂移 | ✅ 短 item 已经天然短段 | 保持 |

---

## 二、推荐改动（3 档）

### Tier A — 必做（性价比最高，几乎无副作用）

#### A1. 加强 Redundancy 约束（防复读）

在 `_OUTLINE_PROMPT_CORE` 的"讲解原则"第 6 条后追加：

```
⚠️ Redundancy 红线：单 bullet explanation 不得连续复述 PPT 原文 ≥10 个字。
若 PPT 上写"FIFO replaces the oldest page"，不要写"FIFO 会替换最旧的页面"，
而是写"先来先走，把内存里待得最久的页换掉，实现简单但容易把热点页淘汰"。
```

**依据**：Mayer Redundancy Principle (Cambridge Handbook Ch.12)，PresentAgent 把这归类为最常见的 failure mode "text-heavy monotony"。

#### A2. CLT 工作记忆硬上限

在"长度要求"段落追加：

```
- 单 item 的 sub_items 不得超过 4 条（Sweller 工作记忆上限）
- 若 PPT 列出 5+ 项，分组归纳到 2-3 个 sub_items，不要 1:1 罗列
```

#### A3. Grounding-First（防视觉幻觉）

在 JSON 输出前增加一个**隐藏 thinking 字段**（前端不渲染，仅用于约束模型推理路径）：

```json
{
  "grounding": {
    "visual_elements": ["左上：FIFO 队列示意图", "右下：缺页率公式 P = ..."],
    "spatial_layout": "标题在顶部，左图右公式分栏"
  },
  "page_num": 3,
  ...
}
```

prompt 里加：
```
⚠️ 输出 JSON 前必须先填写 grounding 字段：列出 PPT 上你确实看到的视觉元素及其大致位置。
后面所有 items / concepts 只能基于 grounding 里列出的元素，不能超出。
若 grounding 里没有 X，items 里就不能讨论 X。
```

**依据**：Grounded CoT (arXiv 2503.12799)，M3ID (CVPR 2024)。
**预期收益**：减少视觉模型对装饰图、不存在的图表的"脑补"。

---

### Tier B — 建议（A/B 测试后再上线）

#### B1. 自我解释提示（Chi）

在 JSON schema 加可选字段：

```json
{
  "items": [...],
  "self_explanation_prompt": "为什么 FIFO 在循环访问场景下表现差？"
}
```

prompt 里：
```
content / example 类型的页面，可在 self_explanation_prompt 字段写一个
"为什么 / 怎么 / 如果...会怎样"的开放问题，触发学生主动思考。
title / toc / summary 不需要，写 null。
问题必须 1 句、不超过 25 字，答案能在本页讲解里找到线索但不直接给出。
```

**依据**：Chi 1989/1994 — high-explainers 显著优于 low-explainers，效应稳健。
**风险**：可能被部分用户感知为啰嗦（取决于产品定位）。建议 A/B test。

#### B2. Modality / Personalization 微调（可选）

把"按知识点分组"那段改一下口吻：

```
6. 解释要像老师在白板边讲给同学听，不是写教科书段落。
   用"你""我们"代替"学生""读者"。
   每句尽量≤20字，长句拆短。
```

**依据**：Mayer Modality + Personalization Principles。
**风险**：可能与你现在"提纲式讲解"的定位冲突，看产品决定。

---

### Tier C — 实验性（需要研究 RL/微调）

- **Page-type-conditioned prompts**：现在所有 page_type 共用一个 prompt + 文字补丁。可以拆成 5-6 个 prompt（title/toc/intro/content/example/summary 各一），每个长度更短、更针对。
- **Few-shot anchoring**：每类 page_type 给 1 个高质量 in-context 示例（你的 `_JSON_SCHEMA_EXAMPLE` 已经在做，但只有 1 个 content 例子）。
- **Knowledge graph feedback loop**：用全文档已抽出的 `concepts` 做后续页的 pre-training context，避免概念定义重复。

---

## 三、评估框架（必须建，否则上面所有改动都是赌博）

### 3.1 LLM-Rubric — 7 维多选打分

每次生成一份卡片，由一个 judge LLM（推荐用 Qwen-VL-Max 或 GPT-4o，**不要用同一个生成模型自评**）按 1–4 Likert 打 7 个维度：

| # | 维度 | 1（差） → 4（优）的判据 |
|---|---|---|
| Q1 | **Faithfulness** 视觉接地 | 1: 多处幻觉 / 4: 全部 claim 都能在 slide 找到依据 |
| Q2 | **Redundancy** 不复读 | 1: 几乎全是 verbatim / 4: 完全转译为口语解释 |
| Q3 | **Coverage** 概念覆盖 | 1: 漏掉核心 / 4: 全部要点 + 关键支撑细节 |
| Q4 | **Chunking** 分块 | 1: 巨长段落 / 4: 4-8 卡，每卡 ≤4 项 |
| Q5 | **Signaling** 重点信号 | 1: 无加粗无高亮 / 4: 重点 + 术语都有合理标注 |
| Q6 | **Self-Explanation** 思考引导 | 1: 纯灌输 / 4: 高质量"为什么"问题 |
| Q7 | **Coherence** 卡间连贯 | 1: 跳跃断裂 / 4: 卡之间逻辑链条清晰 |

实现：把 7 个 Likert 题写成一个 judge prompt，输入 `<slide_image> + <generated_cards_json>`，让 judge 输出 7 个数字 + 一行理由。
跑一批后取均值，每维一个分数。

**依据**：LLM-Rubric (ACL 2024, arXiv 2501.00274)。

### 3.2 PresentAgent Quiz Accuracy — "学完能答题"指标

**协议**：
- 每张 slide 预先人工/Claude 出 **5 道四选一题**（covering 主题识别 / 结构理解 / 主要论点）
- 把"slide 图 + 你的讲解卡片"喂给一个 evaluator VLM
- 让它答 5 题，正确数 / 5 = quiz accuracy

**目标基线**：PresentAgent 论文里 Claude-3.7-Sonnet 拿到 **0.64**。你应该 ≥ 这个数才算合格。

**实现成本**：50 张 slides × 5 题 = 250 道题，要人工/AI 出题，是一次性投入。

### 3.3 MLP Retrieval — "讲解能不能反向匹配回 slide"

证明你的讲解不是"任何 slide 都能套用的水货"，而是**唯一对应这页**。

**步骤**：
1. 选 50 张 slide，每张生成讲解
2. 用 CLIP / Qwen-VL 把 50 张图 + 50 份讲解都嵌入到同一空间
3. 对每份讲解，算它对 50 张图的 cosine similarity，排序
4. 报 **Recall@1**（讲解的 top-1 是否就是它对应的 slide）和 **Recall@5**

**目标**：Recall@1 ≥ 80% 算优秀，<50% 说明你的讲解太泛化。

### 3.4 A/B 测试协议

| 项目 | 设定 |
|---|---|
| **样本** | 50–60 张 slide，跨 3+ 学科（CS / 数学 / 文科）保证多样性 |
| **变量** | 只换 prompt（V1 vs V2），固定模型、温度、其他参数 |
| **盲性** | judge LLM 不知道哪份是 V1/V2，标签随机化 |
| **统计检验** | **paired t-test** 或 **paired permutation test**，p<0.05 算显著 |
| **报告** | 7 个 LLM-Rubric 维度均值 + Quiz Accuracy 均值 + Recall@1/5 + 解析格式成功率（JSON 解析无报错的比例） |

---

## 四、落地路线图

### Phase 1（本周可做）— 加 3 条硬约束 + 评估骨架

- [ ] 在 `prompt_templates.py` 的 `_OUTLINE_PROMPT_CORE` 应用 **A1 / A2** 改动
- [ ] 在 JSON schema 加 `grounding` 字段 + prompt 文字（**A3**）
- [ ] 准备一个 50 slides 的 benchmark set（你的真实文档里抽，覆盖你常见的 OS/线代等课程）
- [ ] 写 `tools/eval_rubric.py`：跑 LLM-Rubric 7 题打分

### Phase 2（下周）— Quiz + Retrieval

- [ ] 为 50 slides 各出 5 题（前 10 张人工，后 40 张 Claude 出 + 你审核）
- [ ] 写 `tools/eval_quiz.py`：跑 PresentAgent quiz 协议
- [ ] 写 `tools/eval_retrieval.py`：用 Qwen embedding 跑 MLP-style 检索

### Phase 3（下下周）— A/B 验证 + 进阶改动

- [ ] V1 = 当前版 / V2 = 应用 Tier A 的版本，跑全套评估
- [ ] 若 V2 显著更好，合入主线
- [ ] V3 加 Tier B（self-explanation），再 A/B
- [ ] 写一份 1-pager"prompt 优化效果报告"，可作为论文/简历素材

---

## 五、用 NotebookLM 做后续设计的工作流

1. NotebookLM ID：`teaching-learning-ppt讲解-论文库`（已加入库）
2. 每次设计新功能（如知识图谱、闪卡）时，先去 NotebookLM 问"基于这些论文，X 功能应该怎么设计"
3. 设计文档 + 评估结果都写进 `docs/`，下次能复现迭代逻辑

---

## 附：本次设计直接引用的论文

- Mayer, R. E. (2014). *Principles for Reducing Extraneous Processing*. Cambridge Handbook of Multimedia Learning, Ch.12 → `13_Mayer_Extraneous_Processing.pdf`
- Mayer, R. E. (2024). *Past, Present, and Future of CTML*. Educational Psychology Review → `18_Mayer_Past_Present_Future_2024.pdf`
- Sweller, J. (1994). *Cognitive Load Theory* → `11_Sweller_CLT_1994.pdf`
- Chi 综述 → `15_Self_Explaining_Chi_summary.pdf`
- Lee et al. (2022). *Multimodal Lecture Presentations Dataset* → `01_MLP_2022.pdf`
- PPTAgent + PPTEval → `02_PPTAgent_2501.03936.pdf`
- PresentAgent → `03_PresentAgent_2507.04036.pdf`
- AI Tutor 评估分类法 → `04_AITutor_Eval_Taxonomy_2412.09416.pdf`
- LLM-Rubric (ACL 2024) → `06_LLM_Rubric_2501.00274.pdf`
- Grounded CoT → `07_Grounded_CoT_MLLM_2503.12799.pdf`
- M3ID Anti-hallucination (CVPR 2024) → `08_M3ID_2403.14003.pdf`
