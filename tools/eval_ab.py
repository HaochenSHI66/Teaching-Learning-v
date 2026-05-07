#!/usr/bin/env python3
"""
eval_ab.py — A/B test comparison script with paired t-test.

Compares two sets of eval results (V1 vs V2) and runs a paired t-test
(or permutation test if scipy unavailable) to determine statistical significance.

Usage:
    # Compare two rubric result files
    python tools/eval_ab.py --v1 tools/eval_results/rubric_20260501_120000.json \
                            --v2 tools/eval_results/rubric_20260507_153145.json

    # Compare quiz results
    python tools/eval_ab.py --v1 tools/eval_results/quiz_A.json \
                            --v2 tools/eval_results/quiz_B.json \
                            --type quiz
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from pathlib import Path
from statistics import mean, stdev

# ---------------------------------------------------------------------------
# Statistical tests
# ---------------------------------------------------------------------------

def _ttest_rel_scipy(a: list[float], b: list[float]) -> float:
    """Paired t-test using scipy (preferred)."""
    from scipy.stats import ttest_rel  # type: ignore
    _, p = ttest_rel(a, b)
    return float(p)


def _ttest_rel_stdlib(a: list[float], b: list[float]) -> float:
    """Paired t-test using only stdlib + statistics.

    t = mean(d) / (stdev(d) / sqrt(n)),  df = n - 1
    Two-tailed p-value via t-distribution approximation.
    """
    n = len(a)
    if n < 2:
        return float("nan")
    diffs = [x - y for x, y in zip(a, b)]
    d_mean = mean(diffs)
    d_sd = stdev(diffs)
    if d_sd == 0:
        return 0.0 if d_mean != 0 else 1.0
    t_stat = d_mean / (d_sd / math.sqrt(n))
    df = n - 1
    # Two-tailed p via regularized incomplete beta function approximation
    p = _t_dist_p(abs(t_stat), df)
    return p


def _t_dist_p(t: float, df: int) -> float:
    """Approximate two-tailed p-value for t-distribution using math.lgamma.

    Uses the relationship between the t-distribution CDF and the regularized
    incomplete beta function: p = I(df/(df+t^2); df/2, 1/2).
    """
    x = df / (df + t * t)
    # Regularized incomplete beta I_x(a, b) approximated by continued fraction
    a = df / 2.0
    b = 0.5
    p_one_tail = _regularized_incomplete_beta(x, a, b) / 2.0
    return 2.0 * p_one_tail


def _regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    """Regularized incomplete beta I_x(a,b) via continued fraction (Lentz's method)."""
    if x < 0 or x > 1:
        return float("nan")
    if x == 0:
        return 0.0
    if x == 1:
        return 1.0

    log_beta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    front = math.exp(math.log(x) * a + math.log(1 - x) * b - log_beta) / a

    # Use symmetry for faster convergence
    if x > (a + 1) / (a + b + 2):
        return 1.0 - _regularized_incomplete_beta(1 - x, b, a)

    # Continued fraction via modified Lentz
    def _cf() -> float:
        TINY = 1e-30
        MAX_ITER = 200
        EPS = 3e-7

        f = TINY
        C = f
        D = 0.0

        for m in range(MAX_ITER):
            # Even step
            if m == 0:
                num = 1.0
            else:
                num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
            D = 1.0 + num * D
            if abs(D) < TINY:
                D = TINY
            C = 1.0 + num / C
            if abs(C) < TINY:
                C = TINY
            D = 1.0 / D
            delta = C * D
            f *= delta

            # Odd step
            m2 = m + 1
            num = -(a + m2) * (a + b + m) * x / ((a + 2 * m2 - 1) * (a + 2 * m2))
            D = 1.0 + num * D
            if abs(D) < TINY:
                D = TINY
            C = 1.0 + num / C
            if abs(C) < TINY:
                C = TINY
            D = 1.0 / D
            delta = C * D
            f *= delta

            if abs(delta - 1.0) < EPS:
                break

        return f

    return front * _cf()


def _permutation_test(a: list[float], b: list[float], n_perm: int = 2000) -> float:
    """Paired permutation test fallback.

    Under H0, the sign of each paired difference is exchangeable.
    Returns two-tailed p-value.
    """
    n = len(a)
    if n < 2:
        return float("nan")
    diffs = [x - y for x, y in zip(a, b)]
    obs_stat = abs(mean(diffs))

    rng = random.Random(42)
    count_extreme = 0
    for _ in range(n_perm):
        perm_diffs = [d if rng.random() < 0.5 else -d for d in diffs]
        if abs(mean(perm_diffs)) >= obs_stat:
            count_extreme += 1

    return (count_extreme + 1) / (n_perm + 1)  # add 1 for continuity


def paired_pvalue(a: list[float], b: list[float]) -> tuple[float, str]:
    """Return (p_value, method_name). Tries scipy first, falls back to stdlib t-test."""
    if len(a) < 2:
        return float("nan"), "n/a (n<2)"
    try:
        p = _ttest_rel_scipy(a, b)
        return p, "scipy paired t-test"
    except ImportError:
        pass
    try:
        p = _ttest_rel_stdlib(a, b)
        return p, "stdlib paired t-test"
    except Exception:
        p = _permutation_test(a, b)
        return p, "permutation test"


# ---------------------------------------------------------------------------
# Result loading
# ---------------------------------------------------------------------------

RUBRIC_DIMS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]
DIM_LABELS = {
    "Q1": "Q1 Faithfulness",
    "Q2": "Q2 Redundancy",
    "Q3": "Q3 Coverage",
    "Q4": "Q4 Chunking",
    "Q5": "Q5 Signaling",
    "Q6": "Q6 Self-Expl.",
    "Q7": "Q7 Coherence",
}


def load_rubric(path: Path) -> dict[tuple[str, int], dict]:
    """Load rubric JSON. Returns {(document_id, page_num): judgment_dict}."""
    data = json.loads(path.read_text(encoding="utf-8"))
    index: dict[tuple[str, int], dict] = {}
    for r in data.get("results", []):
        key = (r["document_id"], r["page_num"])
        judgment = r.get("judgment") or {}
        # Keep only numeric scores for the 7 dimensions
        scores = {q: float(judgment[q]) for q in RUBRIC_DIMS if isinstance(judgment.get(q), (int, float))}
        if scores:
            index[key] = scores
    return index


def load_quiz(path: Path) -> dict[tuple[str, int], float]:
    """Load quiz JSON. Returns {(document_id, page_num): accuracy}."""
    data = json.loads(path.read_text(encoding="utf-8"))
    index: dict[tuple[str, int], float] = {}
    for r in data.get("results", []):
        key = (r["document_id"], r["page_num"])
        if isinstance(r.get("accuracy"), (int, float)):
            index[key] = float(r["accuracy"])
    return index


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def _sig_label(p: float) -> str:
    if math.isnan(p):
        return "N/A"
    if p < 0.001:
        return "✅ p<0.001"
    if p < 0.01:
        return "✅ p<0.01"
    if p < 0.05:
        return "✅ p<0.05"
    return "❌ n.s."


def _fmt_p(p: float) -> str:
    if math.isnan(p):
        return "N/A    "
    if p < 0.0005:
        return f"{p:.3e}"
    return f"{p:.3f}   "


def _fmt_delta(d: float) -> str:
    return f"{d:+.2f}"


# ---------------------------------------------------------------------------
# A/B comparison — rubric type
# ---------------------------------------------------------------------------

def run_rubric_ab(v1_path: Path, v2_path: Path) -> None:
    v1_data = load_rubric(v1_path)
    v2_data = load_rubric(v2_path)

    common_keys = sorted(set(v1_data) & set(v2_data))
    n_matched = len(common_keys)
    n_v1 = len(v1_data)
    n_v2 = len(v2_data)

    print()
    print("A/B Test Report")
    print(f"V1: {v1_path.name} (n={n_matched} matched slides)")
    print(f"V2: {v2_path.name}")
    print()
    print(f"Matched slides: {n_matched} / {n_v1} V1 slides, {n_matched} / {n_v2} V2 slides")
    print()

    if n_matched == 0:
        print("No matching slides found. Check that both files cover the same documents.")
        sys.exit(1)

    # Collect per-dimension paired scores
    dim_v1: dict[str, list[float]] = {q: [] for q in RUBRIC_DIMS}
    dim_v2: dict[str, list[float]] = {q: [] for q in RUBRIC_DIMS}

    for key in common_keys:
        s1 = v1_data[key]
        s2 = v2_data[key]
        for q in RUBRIC_DIMS:
            if q in s1 and q in s2:
                dim_v1[q].append(s1[q])
                dim_v2[q].append(s2[q])

    # Determine test method (check once)
    _, method = paired_pvalue([1.0], [1.0]) if n_matched >= 2 else (float("nan"), "n/a")
    # Actually call with real data to get method
    first_dim = next(q for q in RUBRIC_DIMS if len(dim_v1[q]) >= 2)
    _, method = paired_pvalue(dim_v1[first_dim], dim_v2[first_dim])

    col_w = 16
    hdr = f"{'Dimension':<{col_w}}  {'V1 mean':>7}  {'V2 mean':>7}  {'Δ':>6}  {'p-value':>9}  Sig?"
    print(hdr)
    print("─" * len(hdr))

    sig_dims: list[str] = []
    all_v1_flat: list[float] = []
    all_v2_flat: list[float] = []

    for q in RUBRIC_DIMS:
        a = dim_v1[q]
        b = dim_v2[q]
        if not a:
            print(f"{DIM_LABELS[q]:<{col_w}}  {'N/A':>7}  {'N/A':>7}  {'N/A':>6}  {'N/A':>9}  N/A")
            continue

        m1 = mean(a)
        m2 = mean(b)
        delta = m2 - m1
        p, _ = paired_pvalue(a, b)
        sig = _sig_label(p)
        if "✅" in sig:
            sig_dims.append(q)

        all_v1_flat.extend(a)
        all_v2_flat.extend(b)

        print(
            f"{DIM_LABELS[q]:<{col_w}}  {m1:>7.2f}  {m2:>7.2f}  {_fmt_delta(delta):>6}  {_fmt_p(p):>9}  {sig}"
        )

    # Overall average row (pair each slide's mean across all dims)
    overall_v1: list[float] = []
    overall_v2: list[float] = []
    for key in common_keys:
        s1 = v1_data[key]
        s2 = v2_data[key]
        vals1 = [s1[q] for q in RUBRIC_DIMS if q in s1]
        vals2 = [s2[q] for q in RUBRIC_DIMS if q in s2]
        if vals1 and vals2:
            overall_v1.append(mean(vals1))
            overall_v2.append(mean(vals2))

    if overall_v1:
        om1 = mean(overall_v1)
        om2 = mean(overall_v2)
        delta_o = om2 - om1
        p_o, _ = paired_pvalue(overall_v1, overall_v2)
        sig_o = _sig_label(p_o)
        print("─" * len(hdr))
        print(
            f"{'Overall avg':<{col_w}}  {om1:>7.2f}  {om2:>7.2f}  {_fmt_delta(delta_o):>6}  {_fmt_p(p_o):>9}  {sig_o}"
        )

    print()
    print(f"Statistical test: {method}")
    print()

    # Recommendation
    n_sig = len(sig_dims)
    rec_parts: list[str] = []
    if n_sig > 0:
        rec_parts.append(f"V2 is significantly better on {n_sig}/{len(RUBRIC_DIMS)} dimensions.")
    else:
        rec_parts.append("No dimension shows a statistically significant improvement.")

    if overall_v1:
        if "✅" in sig_o:
            rec_parts.append(f"Overall average significantly {'improved' if delta_o > 0 else 'degraded'} (p={p_o:.3f}).")
        else:
            rec_parts.append(f"Overall average not significantly changed (p={p_o:.3f}).")

    print("Recommendation: " + " ".join(rec_parts))
    print()


# ---------------------------------------------------------------------------
# A/B comparison — quiz type
# ---------------------------------------------------------------------------

def run_quiz_ab(v1_path: Path, v2_path: Path) -> None:
    v1_data = load_quiz(v1_path)
    v2_data = load_quiz(v2_path)

    common_keys = sorted(set(v1_data) & set(v2_data))
    n_matched = len(common_keys)
    n_v1 = len(v1_data)
    n_v2 = len(v2_data)

    print()
    print("A/B Test Report (quiz accuracy)")
    print(f"V1: {v1_path.name} (n={n_matched} matched slides)")
    print(f"V2: {v2_path.name}")
    print()
    print(f"Matched slides: {n_matched} / {n_v1} V1 slides, {n_matched} / {n_v2} V2 slides")
    print()

    if n_matched == 0:
        print("No matching slides found.")
        sys.exit(1)

    a = [v1_data[k] for k in common_keys]
    b = [v2_data[k] for k in common_keys]

    m1 = mean(a)
    m2 = mean(b)
    delta = m2 - m1
    p, method = paired_pvalue(a, b)
    sig = _sig_label(p)

    col_w = 16
    hdr = f"{'Metric':<{col_w}}  {'V1 mean':>7}  {'V2 mean':>7}  {'Δ':>6}  {'p-value':>9}  Sig?"
    print(hdr)
    print("─" * len(hdr))
    print(
        f"{'Quiz accuracy':<{col_w}}  {m1:>7.3f}  {m2:>7.3f}  {_fmt_delta(delta):>6}  {_fmt_p(p):>9}  {sig}"
    )
    print()
    print(f"Statistical test: {method}")
    print()

    if "✅" in sig:
        direction = "improved" if delta > 0 else "degraded"
        print(f"Recommendation: Quiz accuracy significantly {direction} in V2 (p={p:.3f}).")
    else:
        print(f"Recommendation: No significant difference in quiz accuracy (p={p:.3f}).")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="A/B test comparison of eval results with paired t-test"
    )
    parser.add_argument("--v1", required=True, help="Path to V1 result JSON")
    parser.add_argument("--v2", required=True, help="Path to V2 result JSON")
    parser.add_argument(
        "--type",
        choices=["rubric", "quiz"],
        default="rubric",
        help="Result type to compare (default: rubric)",
    )
    args = parser.parse_args()

    v1_path = Path(args.v1)
    v2_path = Path(args.v2)

    for p in (v1_path, v2_path):
        if not p.exists():
            raise SystemExit(f"File not found: {p}")

    if args.type == "rubric":
        run_rubric_ab(v1_path, v2_path)
    else:
        run_quiz_ab(v1_path, v2_path)


if __name__ == "__main__":
    main()
