from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
import re
from typing import Any

import yaml


@dataclass(frozen=True)
class QualityRule:
    name: str
    scope: str
    metric: str
    operator: str
    threshold: Any
    severity: str
    topic_pattern: str | None = None
    enabled: bool = True
    message: str | None = None
    suggestion: str | None = None


def load_rules(rules_path: Path | None = None) -> list[QualityRule]:
    default_path = files("km_data_quality_check").joinpath("default_quality_rules.yaml")
    with default_path.open("r", encoding="utf-8") as file:
        default_config = yaml.safe_load(file) or {}

    rules = list(default_config.get("rules", []))
    if rules_path is not None:
        with rules_path.open("r", encoding="utf-8") as file:
            user_config = yaml.safe_load(file) or {}
        rules = _merge_rules(rules, list(user_config.get("rules", [])))

    return [_to_rule(item) for item in rules]


def enabled_rules(rules: list[QualityRule]) -> list[QualityRule]:
    return [rule for rule in rules if rule.enabled]


def target_matches(rule: QualityRule, target: str) -> bool:
    if not rule.topic_pattern:
        return True
    return re.search(rule.topic_pattern, target) is not None


def evaluate_rule(rule: QualityRule, target: str, value: Any) -> dict[str, Any]:
    passed = _compare(value, rule.operator, rule.threshold)
    status = "pass" if passed else rule.severity
    threshold = rule.threshold
    message = rule.message or _default_message(rule, target, value, passed)
    suggestion = "" if passed else (rule.suggestion or _default_suggestion(rule))

    return {
        "rule_name": rule.name,
        "scope": rule.scope,
        "target": target,
        "metric": rule.metric,
        "value": _json_value(value),
        "threshold": _json_value(threshold),
        "status": status,
        "message": message,
        "suggestion": suggestion,
    }


def make_check(
    rule_name: str,
    scope: str,
    target: str,
    metric: str,
    value: Any,
    threshold: Any,
    status: str,
    message: str,
    suggestion: str = "",
) -> dict[str, Any]:
    return {
        "rule_name": rule_name,
        "scope": scope,
        "target": target,
        "metric": metric,
        "value": _json_value(value),
        "threshold": _json_value(threshold),
        "status": status,
        "message": message,
        "suggestion": suggestion,
    }


def _merge_rules(default_rules: list[dict[str, Any]], user_rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = [dict(rule) for rule in default_rules]
    indexes = {str(rule.get("name")): index for index, rule in enumerate(merged)}

    for user_rule in user_rules:
        name = str(user_rule.get("name", ""))
        if name in indexes:
            updated = dict(merged[indexes[name]])
            updated.update(user_rule)
            merged[indexes[name]] = updated
        else:
            merged.append(dict(user_rule))
    return merged


def _to_rule(item: dict[str, Any]) -> QualityRule:
    return QualityRule(
        name=str(item["name"]),
        scope=str(item["scope"]),
        metric=str(item["metric"]),
        operator=str(item["operator"]),
        threshold=item.get("threshold"),
        severity=str(item.get("severity", "error")),
        topic_pattern=item.get("topic_pattern"),
        enabled=bool(item.get("enabled", True)),
        message=item.get("message"),
        suggestion=item.get("suggestion"),
    )


def _compare(value: Any, operator: str, threshold: Any) -> bool:
    if operator == "exists":
        return bool(value)
    if operator == "not_exists":
        return not bool(value)
    if operator == "==":
        return value == threshold

    try:
        left = float(value)
        right = float(threshold)
    except (TypeError, ValueError):
        return False

    if operator == ">=":
        return left >= right
    if operator == "<=":
        return left <= right
    raise ValueError(f"Unsupported quality rule operator: {operator}")


def _default_message(rule: QualityRule, target: str, value: Any, passed: bool) -> str:
    result = "passed" if passed else "failed"
    return (
        f"{target} {rule.metric} {result}: value={value}, "
        f"operator {rule.operator}, threshold={rule.threshold}"
    )


def _default_suggestion(rule: QualityRule) -> str:
    if rule.scope == "file":
        return "Check whether recording finished correctly and the expected raw files were copied."
    if rule.scope == "topic":
        return "Check the publisher for this topic and verify recording QoS/frequency settings."
    if rule.scope == "video":
        return "Check camera capture settings, exposure, focus, and recording FPS."
    if rule.scope == "alignment":
        return "Check clock synchronization and recording start/stop timing."
    return "Inspect this recording before conversion."


def _json_value(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    return value
