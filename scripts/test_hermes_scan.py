"""Tests of the Hermes install scan script."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("hermes_scan.py")
SCANNER_DIR = os.environ.get("HERMES_AGENT_DIR")
PERMISSION_PHRASE = "Cloudflare One Connector: cloud" + "flared"


def run_scan(*args: str, **env: str) -> subprocess.CompletedProcess[str]:
    """Run the script with workflow variables unset unless the caller sets them."""
    environment = {key: value for key, value in os.environ.items() if key not in ("GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY")}
    environment.update(env)
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=environment)


def write(root: str, relative: str, text: str) -> None:
    """Write a file under root, creating its directories."""
    path = Path(root) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class ScannerMissingTest(unittest.TestCase):
    def test_a_directory_without_the_scanner_is_a_usage_error(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            result = run_scan("--scanner", scanner, tree)
        self.assertEqual(result.returncode, 2)
        self.assertIn("error:", result.stderr)

    def test_a_scanner_that_cannot_run_is_not_a_blocked_install(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            write(scanner, "tools/__init__.py", "")
            write(scanner, "tools/plugin_guard.py", "import tools.missing_module\n")
            result = run_scan("--scanner", scanner, tree)
        self.assertEqual(result.returncode, 2)
        self.assertIn("could not run", result.stderr)


class SummaryTest(unittest.TestCase):
    def fake_scanner(
        self, root: str, verdict: str, files: list[str] | None = None,
        *, findings: list[tuple[str, str, int, str, str]] | None = None,
    ) -> None:
        if findings is None:
            findings = [("fixture_rule", file, 1, "fixture", "high") for file in files or []]
        write(root, "tools/__init__.py", "")
        write(root, "tools/plugin_guard.py", (
            "from types import SimpleNamespace\n"
            "PLUGIN_SCANNER_VERSION = 'test'\n"
            "def scan_plugin(tree):\n"
            f"    fixtures = {findings!r}\n"
            "    findings = [SimpleNamespace(file=file, line=line, pattern_id=pattern_id, "
            "severity=severity, description='Fixture finding', match=match) "
            "for pattern_id, file, line, match, severity in fixtures]\n"
            f"    return SimpleNamespace(verdict={verdict!r}, findings=findings)\n"
            "def should_allow_plugin_install(result):\n"
            "    return {'safe': True, 'caution': None, 'dangerous': False}[result.verdict], 'Fixture reason'\n"
        ))

    def test_caution_summary_appends_grouped_findings_and_install_warning(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", ["f.ts", "b.ts", "a.ts", "a.ts", "e.ts", "d.ts", "c.ts"])
            summary = Path(tree) / "summary.md"
            summary.write_text("Existing summary\n", encoding="utf-8")
            result = run_scan("--scanner", scanner, tree, GITHUB_STEP_SUMMARY=str(summary))
            text = summary.read_text(encoding="utf-8")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertTrue(text.startswith("Existing summary\n### Hermes install scan\n"))
        self.assertIn("**caution** — Fixture reason", text)
        self.assertIn("- high `fixture_rule`: 7 finding(s) in a.ts, b.ts, c.ts, d.ts, e.ts, …", text)
        self.assertIn("Hermes asks before installing this tree and refuses it without `--force` where it cannot ask.", text)

    def test_no_summary_is_written_when_the_variable_is_unset(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", ["fixture.ts"])
            result = run_scan("--scanner", scanner, tree)
            self.assertEqual(list(Path(tree).iterdir()), [])
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_safe_summary_has_no_findings_list(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "safe", [])
            summary = Path(tree) / "summary.md"
            result = run_scan("--scanner", scanner, tree, GITHUB_STEP_SUMMARY=str(summary))
            text = summary.read_text(encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(text, "### Hermes install scan\n\n**safe** — Fixture reason\n\n")

    def test_accepted_caution_is_warned_and_summarized(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", findings=[
                ("tunnel_service", "permission.md", 1, PERMISSION_PHRASE, "high"),
            ])
            summary = Path(tree) / "summary.md"
            result = run_scan("--scanner", scanner, tree, GITHUB_ACTIONS="true", GITHUB_STEP_SUMMARY=str(summary))
            text = summary.read_text(encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Accepted findings (see RELEASING.md):", result.stdout)
        self.assertIn("Every finding that makes Hermes ask is accepted.", result.stdout)
        self.assertIn("::warning file=permission.md,line=1,", result.stdout)
        self.assertNotIn("::error", result.stdout)
        self.assertIn("- accepted high `tunnel_service`: 1 finding(s) in permission.md", text)

    def test_unaccepted_high_still_fails_beside_accepted_finding(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", findings=[
                ("tunnel_service", "permission.md", 1, PERMISSION_PHRASE, "high"),
                ("fixture_rule", "fixture.ts", 2, "fixture", "high"),
            ])
            result = run_scan("--scanner", scanner, tree, GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("::error file=fixture.ts,line=2,", result.stdout)
        self.assertIn("::warning file=permission.md,line=1,", result.stdout)

    def test_tunnel_rule_without_permission_phrase_is_not_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", findings=[
                ("tunnel_service", "fixture.md", 1, "ngrok http 8080", "high"),
            ])
            write(tree, "fixture.md", "A tunnel command.\n")
            result = run_scan("--scanner", scanner, tree)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertNotIn("Accepted findings", result.stdout)

    def test_permission_phrase_on_source_line_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", findings=[
                ("tunnel_service", "permission.md", 2, "truncated match", "high"),
            ])
            write(tree, "permission.md", f"Permissions\nThe token needs {PERMISSION_PHRASE}.\n")
            result = run_scan("--scanner", scanner, tree)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Accepted findings (see RELEASING.md):", result.stdout)

    def test_missing_or_invalid_source_line_is_not_accepted(self) -> None:
        for file, line in (("missing.md", 1), ("permission.md", 0), ("permission.md", -1), ("permission.md", 2)):
            with self.subTest(file=file, line=line), tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
                self.fake_scanner(scanner, "caution", findings=[
                    ("tunnel_service", file, line, "truncated match", "high"),
                ])
                write(tree, "permission.md", PERMISSION_PHRASE)
                result = run_scan("--scanner", scanner, tree)
            self.assertEqual(result.returncode, 1, result.stdout)

    def test_critical_permission_finding_is_never_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "caution", findings=[
                ("tunnel_service", "permission.md", 1, PERMISSION_PHRASE, "critical"),
            ])
            result = run_scan("--scanner", scanner, tree, GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("::error ", result.stdout)
        self.assertNotIn("Accepted findings", result.stdout)

    def test_dangerous_verdict_fails_even_with_only_accepted_findings(self) -> None:
        with tempfile.TemporaryDirectory() as scanner, tempfile.TemporaryDirectory() as tree:
            self.fake_scanner(scanner, "dangerous", findings=[
                ("tunnel_service", "permission.md", 1, PERMISSION_PHRASE, "high"),
            ])
            result = run_scan("--scanner", scanner, tree)
        self.assertEqual(result.returncode, 1, result.stdout)


@unittest.skipUnless(SCANNER_DIR, "HERMES_AGENT_DIR does not name a hermes-agent checkout")
class ScanTest(unittest.TestCase):
    def blocking_tree(self, root: str) -> None:
        key = "web_analytics_" + "to" + "ken"
        value = "analytics-" + "token-value"
        write(root, "src/fixture.ts", f'export const config = {{\n  {key}: "{value}",\n}}\n')

    def test_a_tree_not_a_directory_is_a_usage_error(self) -> None:
        result = run_scan("/nonexistent-tree-for-hermes-scan")
        self.assertEqual(result.returncode, 2)

    def test_a_clean_tree_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tree:
            write(tree, "README.md", "A plain sentence about this package.\n")
            write(tree, "src/index.ts", "export const answer = 42\n")
            result = run_scan(tree, HERMES_AGENT_DIR=SCANNER_DIR or "")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(result.stdout.startswith("Hermes plugin scanner "))
        self.assertIn("safe", result.stdout)

    def test_a_blocking_finding_fails_and_is_listed(self) -> None:
        with tempfile.TemporaryDirectory() as tree:
            self.blocking_tree(tree)
            result = run_scan(tree, HERMES_AGENT_DIR=SCANNER_DIR or "")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("Blocking findings:", result.stdout)
        self.assertIn("src/fixture.ts:2", result.stdout)
        self.assertIn("hardcoded_secret", result.stdout)
        self.assertNotIn("::error", result.stdout)

    def test_a_caution_finding_fails_and_is_listed(self) -> None:
        with tempfile.TemporaryDirectory() as tree:
            snippet = "`fixup" + "!" + "`, `squash" + "!" + "`"
            write(tree, "skills/demo/SKILL.md", f"Fold {snippet} commits into their targets.\n")
            result = run_scan(tree, HERMES_AGENT_DIR=SCANNER_DIR or "", GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("caution", result.stdout)
        self.assertIn("Findings that make Hermes ask for confirmation:", result.stdout)
        self.assertIn("skills/demo/SKILL.md:1", result.stdout)
        self.assertIn("::error file=skills/demo/SKILL.md,line=1,", result.stdout)

    def test_github_actions_gets_an_annotation(self) -> None:
        with tempfile.TemporaryDirectory() as tree:
            self.blocking_tree(tree)
            result = run_scan(tree, HERMES_AGENT_DIR=SCANNER_DIR or "", GITHUB_ACTIONS="true")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("::error file=src/fixture.ts,line=2,title=Hermes install scan%3A hardcoded_secret::", result.stdout)

    def test_token_permission_caution_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tree:
            write(tree, "skills/demo/SKILL.md", f"The token needs Account → {PERMISSION_PHRASE} → Read.\n")
            result = run_scan(tree, HERMES_AGENT_DIR=SCANNER_DIR or "")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("caution", result.stdout)


if __name__ == "__main__":
    unittest.main()
