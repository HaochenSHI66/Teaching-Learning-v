# Supervised Learning: Neural Network — 讲解生成 Demo

> 使用 v5 Prompt 模板，由 Claude CLI 直接对着 PPT 截图生成。
> 文档：Supervised Learning-NN.pdf（共 37 页，以下为第 1-6 页）

---

<!-- page_type: title -->

## Supervised Learning: Neural Network

这是监督学习系列中关于神经网络 (Neural Network) 的章节起始页。背景展示了 TensorFlow Playground 的可视化界面，包含特征输入、5 层隐藏层和输出层的网络结构。

---

<!-- page_type: toc -->

## Roadmap

- Overview of neural networks
- Single-layer NN: Perceptron
  - Training, delta rule, etc.
  - Limitation
- Multi-layered NN: Multilayered Perceptron (MLP)
  - Chain rule
  - Back-propagation algorithm
  - Other issues
- Take-home messages

---

<!-- page_type: content -->

## Multilayered Perceptron (MLP): A Very First Neural Networks

### 这页讲什么

介绍神经网络的基本构成：由处理单元（神经元）和连接（突触）组成的网络，并列出其关键特性。

### 逐点讲解

- 神经网络由处理单元 (neurons) 通过连接 (synapses) 构成
- 人脑神经元数量巨大：约 $10^{10}$ 个
- 每个神经元的连接数也很大：约 $10^5$ 个
- 并行处理 (Parallel Processing)：多个神经元可以同时工作
- 分布式计算/存储 (Distributed Computation/Memory)：信息不集中在单一位置
- 对噪声和故障具有鲁棒性 (Robust to Noise, Failures)

### 本页关键结论

- <mark>神经网络的核心特征是大规模并行、分布式和鲁棒性</mark>
- 右下角的简单网络图展示了不同颜色节点之间的有向连接，这就是最基础的神经网络结构

---

<!-- page_type: content -->

## Understanding the Brain

### 这页讲什么

从认知科学角度介绍理解大脑的分析框架，以及神经网络作为并行处理系统的定位。

### 逐点讲解

- Marr (1982) 的三层分析框架：
  1. 计算理论 (Computational Theory)：系统在做什么计算？
  2. 表示与算法 (Representation and Algorithm)：用什么表示、什么算法？
  3. 硬件实现 (Hardware Implementation)：物理上怎么实现？
- 逆向工程思路：从硬件层往理论层反推
- 并行处理分两类：
  - SIMD：单指令多数据，所有处理器执行同一条指令
  - MIMD：多指令多数据，每个处理器独立执行
- <mark>神经网络属于 SIMD 架构，但每个节点有可修改的本地存储</mark>
- 学习的本质：通过训练/经验 ($E$) 来更新网络参数

### 本页关键结论

- Marr 的三层分析是理解神经系统的经典框架
- 神经网络是带本地存储的 SIMD 系统，通过经验来学习

---

<!-- page_type: content -->

## A Perceptron

### 这页讲什么

介绍感知机的数学结构：输入、权重、加权求和。

### 逐点讲解

- 左侧图示展示了感知机的网络结构：底层为输入节点 $x_0=+1, x_1, x_2, \dots, x_d$，通过权重 $w_0, w_1, w_2, \dots, w_d$ 连接到顶层输出节点 $y$
- $x_0 = +1$ 是偏置项 (bias) 对应的固定输入
- <mark>感知机的计算公式</mark>：

$$y = \sum_{j=1}^{d} w_j x_j + w_0 = \mathbf{w}^T \mathbf{x}$$

- 权重向量：$\mathbf{w} = [w_0, w_1, \dots, w_d]^T$
- 输入向量：$\mathbf{x} = [1, x_1, \dots, x_d]^T$（注意第一个分量固定为 1）
- 出自 Rosenblatt, 1962

### 本页关键结论

- 感知机本质是输入的加权线性组合，可以写成向量内积 $\mathbf{w}^T \mathbf{x}$
- 偏置 $w_0$ 通过固定输入 $x_0=1$ 统一到向量乘法中

---

<!-- page_type: content -->

## What a Perceptron Does?

### 这页讲什么

展示感知机的两种用途——回归和分类，以及三种激活函数。

### 逐点讲解

- 回归 (Regression)：$y = wx + w_0$，对应左侧图的线性拟合 (Line Fitting)，输出是连续值
- 分类 (Classification)：$y = \mathbf{1}(wx + w_0 > 0)$，对应右侧图，输出是 0 或 1，用一条直线将数据分为两类
- 三种激活函数 (Activation Functions)：
  - 阶跃函数 (1 or Step Activation)：$y = \mathbf{1}(o) = \begin{cases} 1 & \text{if } o > 0 \\ 0 & \text{otherwise} \end{cases}$
  - Sigmoid 激活：$y = \text{sigmoid}(o) = \frac{1}{1 + e^{-\mathbf{w}^T \mathbf{x}}}$，输出在 0 到 1 之间的平滑 S 曲线
  - 线性激活 (Linear Activation)：$y = o = \mathbf{w}^T \mathbf{x}$，输出直接等于加权和
- 右上角图示对比了三种激活的输出曲线形状

### 本页关键结论

- <mark>感知机通过不同激活函数可以做回归（线性）或分类（阶跃/sigmoid）</mark>
- Sigmoid 是阶跃函数的平滑版本，输出可以解释为概率
- 线性激活就是不加激活函数，直接输出加权和
