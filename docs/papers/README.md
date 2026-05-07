# Papers — 高质量 PPT 讲解 / 多媒体学习 文献库

下载日期：2026-05-03
用途：为「幻灯片研习台」(learn.shc66.com) 的讲解质量优化提供学术对标。

---

## A. 经典高引（理论基石 · 必读）

| # | 文件 | 引用量级 | 一句话定位 |
|---|---|---|---|
| 11 | `11_Sweller_CLT_1994.pdf` | 10k+ | Sweller 认知负荷理论奠基作 — intrinsic / extraneous / germane 三类负荷 |
| 13 | `13_Mayer_Extraneous_Processing_Coherence_Signaling_Redundancy.pdf` | 5k+ | Mayer 减少 extraneous 处理的 5 大原则（Cambridge Handbook Ch.12 节录） |
| 14 | `14_Mayer_12_Principles_FCLD_Hartford.pdf` | n/a (overview) | Mayer 12 原则速查卡 — 贴墙用 |
| 15 | `15_Self_Explaining_Chi_summary.pdf` | n/a (Chi 1989/1994 综述) | 自我解释效应 — 高解释者 > 低解释者，覆盖 Chi 1989 + 1994 |
| 18 | `18_Mayer_Past_Present_Future_2024.pdf` | 新综述 | Mayer 2024 — CTML 30 年回顾，200+ 实验、15 条原则总结 |

⚠️ **未能直接下载**（Wiley 防爬，建议用学校 VPN 浏览器手存）：
- Chi et al. 1994, *Eliciting Self-Explanations Improves Understanding*, Cognitive Science 18(3) — https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3

---

## B. 文档/幻灯片理解（工程对标 · 高引）

| # | 文件 | 一句话定位 |
|---|---|---|
| 09 | `09_LayoutLM_1912.13318.pdf` | LayoutLM v1 — 文档理解必引基线（KDD 2020，5k+ cites） |
| 10 | `10_LayoutLMv3_2204.08387.pdf` | LayoutLMv3 — 统一图文 mask，文档 AI SOTA（ACM MM 2022） |

---

## C. 幻灯片 / 演示生成 & 评测（最贴近你的产品）

| # | 文件 | 一句话定位 |
|---|---|---|
| 01 | `01_MLP_Multimodal_Lecture_Presentations_2022.pdf` | **Multimodal Lecture Presentations Dataset** — 9000+ slide↔讲解对齐，含 Figure→Text 评测协议 |
| 02 | `02_PPTAgent_2501.03936.pdf` | **PPTAgent + PPTEval** — Content / Design / Coherence 三维评估框架 |
| 03 | `03_PresentAgent_2507.04036.pdf` | **PresentAgent** — 用 quiz accuracy 衡量讲解可学习性（Claude-3.7 0.64） |
| 16 | `16_Slide4N_Computational_Notebooks.pdf` | Slide4N — 从 notebook 自动生成 slide 的早期工作 |

---

## D. AI 导师 / 教学解释质量评估（最贴近你的"追问"功能）

| # | 文件 | 一句话定位 |
|---|---|---|
| 04 | `04_AITutor_Eval_Taxonomy_2412.09416.pdf` | **AI Tutor 评估分类法** — 8 维 pedagogical dimensions 框架 |
| 05 | `05_BEA2025_Pedagogical_Tutors_2507.10579.pdf` | BEA 2025 Shared Task — 4 维（MI/ML/PG/AC）评测大规模结果 |
| 06 | `06_LLM_Rubric_2501.00274.pdf` | **LLM-Rubric (ACL 2024)** — 多选题 rubric + 校准网络对齐人评 |

---

## E. 多模态忠实度 / 抗幻觉（讲解不能瞎编）

| # | 文件 | 一句话定位 |
|---|---|---|
| 07 | `07_Grounded_CoT_MLLM_2503.12799.pdf` | **Grounded CoT** — 把视觉证据 step-by-step 接到推理链上 |
| 08 | `08_M3ID_Hallucination_Grounding_2403.14003.pdf` | **M3ID (CVPR 2024)** — 用互信息抑制语言先验、强化图像证据 |

---

## 推荐阅读路径（4 周节奏）

**Week 1 — 理论地基**
14（速查）→ 13（深读 Mayer 5 原则）→ 11（Sweller CLT）

**Week 2 — 评测武器**
06（LLM-Rubric）→ 02（PPTEval 三维）→ 03（PresentAgent quiz 法）

**Week 3 — 对标系统**
01（MLP 数据集 + 任务定义）→ 04（AI Tutor 8 维）

**Week 4 — 工程加固**
07（Grounded CoT）→ 08（M3ID）→ 09/10（LayoutLM 系列）

---

## 落地到「幻灯片研习台」的 8 条 rubric

综合 Mayer + PPTEval + AI Tutor 评估抽出，建议直接写进 prompt + 自动评测：

1. **Faithfulness 忠实度** — 每条 claim 在 slide 找得到依据（Grounded CoT / M3ID）
2. **Coverage 覆盖度** — 核心概念无遗漏（OCR + 图表 + 公式）
3. **Non-Redundancy 去冗** — 不复读 slide 文字；解释"为什么"而非"是什么"（Mayer Coherence + Redundancy）
4. **Chunking 分块** — 每卡 1 个原子知识点，2–4 句（Sweller CLT + Mayer Segmenting）
5. **Signaling 信号** — Callout 区分 must-know vs nice-to-know（Mayer Signaling）
6. **Coherence 连贯** — 卡片之间逻辑递进（PPTEval Coherence 维）
7. **Term Bilingual** — 专业术语首次出现给 中文(English)（Mayer Pre-training）
8. **Self-Explainability 可学习性** — 讲解能反向出 5 题，正确率 ≥0.6（PresentAgent quiz 法）
