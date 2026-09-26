"""Git-repository storage for the Multi-Motors catalog.

Alternative to SheetsManager: the catalog is a CSV file committed in the
repository, and each run that finds new motors writes a dated Markdown
report. Used by the daily GitHub Actions workflow.
"""

import csv
import logging
from datetime import date
from pathlib import Path

from .config import SHEET_COLUMNS
from .models import MotorSpec

logger = logging.getLogger(__name__)


def _clean(value: str) -> str:
    """Collapse whitespace/newlines scraped from HTML into single spaces."""
    return " ".join(str(value).split())

DEFAULT_CATALOG_DIR = Path("catalogue")


class GitHubStore:
    """Stores motors in catalogue/moteurs.csv and daily reports in catalogue/nouveautes/."""

    def __init__(self, catalog_dir: Path = DEFAULT_CATALOG_DIR):
        self.catalog_dir = Path(catalog_dir)
        self.csv_path = self.catalog_dir / "moteurs.csv"
        self.reports_dir = self.catalog_dir / "nouveautes"
        self.excluded_path = self.catalog_dir / "exclus.txt"
        self._existing_refs: set[str] = set()
        self._row_count = 0
        self.added_today: list[MotorSpec] = []

    def connect(self):
        """Create the catalog file if needed and load existing refs."""
        self.catalog_dir.mkdir(parents=True, exist_ok=True)
        if not self.csv_path.exists():
            with self.csv_path.open("w", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(SHEET_COLUMNS)
            logger.info("Created new catalog %s", self.csv_path)
        self._load_existing_refs()

    def _load_existing_refs(self):
        with self.csv_path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.reader(f))[1:]
        self._row_count = len(rows)
        self._existing_refs = {r[1].strip() for r in rows if len(r) > 1 and r[1].strip()}
        # Refs removed by hand (category pages, drones...) must not come back
        if self.excluded_path.exists():
            for line in self.excluded_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    self._existing_refs.add(line)
        logger.info("Loaded %d existing motor references", len(self._existing_refs))

    def add_motors(self, motors: list[MotorSpec]) -> int:
        """Append new motors to the CSV. Returns count of motors added."""
        new_motors = []
        for motor in motors:
            if not motor.is_valid():
                continue
            if not motor.ref:
                motor.generate_ref()
            if motor.ref not in self._existing_refs:
                self._existing_refs.add(motor.ref)
                new_motors.append(motor)

        if not new_motors:
            return 0

        with self.csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            for i, motor in enumerate(new_motors, start=self._row_count + 1):
                row = [_clean(v) for v in motor.to_sheet_row()]
                row[0] = str(i)
                writer.writerow(row)
                logger.info("Added motor: %s (%s %s %sKV)",
                            motor.ref, motor.marque, motor.nom, motor.kv)

        self._row_count += len(new_motors)
        self.added_today.extend(new_motors)
        return len(new_motors)

    def get_all_refs(self) -> set[str]:
        return self._existing_refs.copy()

    def get_row_count(self) -> int:
        return self._row_count

    def refresh_refs(self):
        self._load_existing_refs()

    def write_daily_report(self, day: date | None = None) -> Path | None:
        """Write catalogue/nouveautes/YYYY-MM-DD.md listing motors added this run."""
        if not self.added_today:
            return None
        day = day or date.today()
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        path = self.reports_dir / f"{day.isoformat()}.md"

        lines = [
            f"# Nouveaux moteurs brushless — {day.isoformat()}",
            "",
            f"{len(self.added_today)} nouveau(x) moteur(s) ajouté(s) au catalogue "
            f"(total : {self._row_count}).",
            "",
            "| REF | Marque | Nom | Stator | KV | Poids (g) | LiPo | Lien |",
            "|-----|--------|-----|--------|----|-----------|------|------|",
        ]
        for m in self.added_today:
            link = f"[fiche]({m.lien})" if m.lien else ""
            cells = [_clean(c) for c in (m.ref, m.marque, m.nom, m.classe, m.kv, m.poids, m.lipo)] + [link]
            lines.append("| " + " | ".join(c.replace("|", "/") for c in cells) + " |")
        lines.append("")

        path.write_text("\n".join(lines), encoding="utf-8")
        logger.info("Wrote daily report %s", path)
        return path
