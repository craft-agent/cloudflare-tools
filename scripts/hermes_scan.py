"""Run Hermes Agent's own plugin install scanner on a tree.

Hermes scans a plugin when it is installed, and a dangerous verdict blocks the
install; `--force` does not override it. This script runs the same scanner
(`tools/plugin_guard.py` from a hermes-agent checkout) on the tree a release
carries, and exits 1 when Hermes would block it.
High findings only warn, appearing in annotations and the job summary.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

SCANNER_ENV = "HERMES_AGENT_DIR"
SCANNER_MODULE = Path("tools") / "plugin_guard.py"
STRUCTURAL_FILE = "(directory)"
SUMMARY_FILE_LIMIT = 5
LISTED_SEVERITIES = (
    ("critical", "error", "Blocking findings:"),
    ("high", "warning", "Findings that make Hermes ask for confirmation:"),
)


def escape_data(value: str) -> str:
    """Escape a workflow command message."""
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(value: str) -> str:
    """Escape a workflow command property value."""
    return escape_data(value).replace(":", "%3A").replace(",", "%2C")


def location(finding: Any) -> str:
    """Return `file:line`, or `file` for a finding without a line."""
    return f"{finding.file}:{finding.line}" if finding.line > 0 else finding.file


def annotation(level: str, finding: Any) -> str:
    """Build the workflow command that annotates a finding."""
    properties = []
    if finding.file != STRUCTURAL_FILE:
        properties.append(f"file={escape_property(finding.file)}")
    if finding.line > 0:
        properties.append(f"line={finding.line}")
    properties.append(f"title={escape_property(f'Hermes install scan: {finding.pattern_id}')}")
    message = escape_data(f"{finding.description}: {finding.match}")
    return f"::{level} {','.join(properties)}::{message}"


def write_summary(result: Any, reason: str) -> None:
    """Append the verdict and grouped high or critical findings to the job summary."""
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = ["### Hermes install scan", "", f"**{result.verdict}** — {reason}", ""]
    for severity, _, _ in LISTED_SEVERITIES:
        patterns: dict[str, list[Any]] = {}
        for finding in result.findings:
            if finding.severity == severity:
                patterns.setdefault(finding.pattern_id, []).append(finding)
        for pattern_id, findings in sorted(patterns.items()):
            files = sorted({finding.file for finding in findings})
            listed_files = files[:SUMMARY_FILE_LIMIT]
            if len(files) > SUMMARY_FILE_LIMIT:
                listed_files.append("…")
            lines.append(f"- {severity} `{pattern_id}`: {len(findings)} finding(s) in {', '.join(listed_files)}")
    if result.verdict == "caution":
        lines.extend(["", "Hermes asks before installing this tree and refuses it without `--force` where it cannot ask."])
    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    """Scan the tree and return the exit code."""
    parser = argparse.ArgumentParser(description="Run the Hermes plugin install scanner on a tree.")
    parser.add_argument("--scanner", default=os.environ.get(SCANNER_ENV), help=f"hermes-agent checkout (default: ${SCANNER_ENV})")
    parser.add_argument("tree", metavar="TREE", help="directory to scan")
    args = parser.parse_args(argv)

    if not args.scanner:
        print(f"error: pass --scanner or set {SCANNER_ENV}", file=sys.stderr)
        return 2
    if not (Path(args.scanner) / SCANNER_MODULE).is_file():
        print(f"error: {Path(args.scanner) / SCANNER_MODULE} does not exist", file=sys.stderr)
        return 2
    tree = Path(args.tree)
    if not tree.is_dir():
        print(f"error: {tree} is not a directory", file=sys.stderr)
        return 2

    sys.path.insert(0, args.scanner)
    # A scanner that cannot run must not read as a blocked install.
    try:
        from tools.plugin_guard import PLUGIN_SCANNER_VERSION, scan_plugin, should_allow_plugin_install

        result = scan_plugin(tree)
        allowed, reason = should_allow_plugin_install(result)
    except Exception as error:
        print(f"error: the scanner could not run: {error!r}", file=sys.stderr)
        return 2
    print(f"Hermes plugin scanner {PLUGIN_SCANNER_VERSION}: {result.verdict}. {reason}")

    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    findings = sorted(result.findings, key=lambda f: (f.file, f.line, f.pattern_id))
    for severity, level, header in LISTED_SEVERITIES:
        listed = [finding for finding in findings if finding.severity == severity]
        if not listed:
            continue
        print(header)
        for finding in listed:
            print(f"  {location(finding)}: {finding.pattern_id} ({severity}) {finding.description}: {finding.match}")
            if annotate:
                print(annotation(level, finding))

    write_summary(result, reason)
    return 1 if allowed is False else 0


if __name__ == "__main__":
    sys.exit(main())
