"""Motor specification parser - extracts structured data from web pages."""

import re
import logging
from typing import Optional

from .config import MOTOR_BRANDS
from .models import MotorSpec

logger = logging.getLogger(__name__)

# --- Regex patterns for motor spec extraction ---

# Stator size: 4-digit like 2207, 1408, 0802
RE_STATOR = re.compile(
    r'\b(\d{4})\b(?:\s*(?:motor|brushless|size|stator))',
    re.IGNORECASE,
)
RE_STATOR_SPLIT = re.compile(
    r'(?:stator|size)[:\s]*(\d{2})\s*[xX×*]\s*(\d{2})',
    re.IGNORECASE,
)
RE_STATOR_PLAIN = re.compile(r'\b([01]\d[0-9]{2}|2[0-9]{3}|3[01]\d{2})\b')

# KV rating
RE_KV = re.compile(r'\b(\d{3,5})\s*[Kk][Vv]\b')

# Weight in grams
RE_WEIGHT = re.compile(
    r'(?:weight|poids|motor weight)[:\s]*[~≈]?\s*(\d+\.?\d*)\s*(?:g(?:rams?)?)\b',
    re.IGNORECASE,
)
RE_WEIGHT_ALT = re.compile(r'\b(\d+\.?\d*)\s*g\b(?!hz)', re.IGNORECASE)

# Shaft diameter
RE_SHAFT_DIA = re.compile(
    r'(?:shaft|arbre)[:\s]*[ØøDd]?\s*(\d+\.?\d*)\s*mm',
    re.IGNORECASE,
)
RE_SHAFT_DIA_ALT = re.compile(
    r'(?:shaft diameter|shaft size)[:\s]*(\d+\.?\d*)\s*(?:mm)?',
    re.IGNORECASE,
)

# Motor dimensions
RE_MOTOR_HEIGHT = re.compile(
    r'(?:motor height|height|hauteur)[:\s]*(\d+\.?\d*)\s*mm',
    re.IGNORECASE,
)
RE_MOTOR_DIAMETER = re.compile(
    r'(?:motor diameter|diameter|diamètre|dia)[:\s]*[ØøDd]?\s*(\d+\.?\d*)\s*mm',
    re.IGNORECASE,
)

# Battery / LiPo
RE_LIPO = re.compile(r'\b(\d[Ss])\s*[-–]\s*(\d[Ss])\b')
RE_LIPO_SINGLE = re.compile(r'\b(\d[Ss])\b')
RE_VOLTAGE = re.compile(
    r'(?:voltage|tension)[:\s]*(\d+\.?\d*)\s*[Vv]',
    re.IGNORECASE,
)

# Current / Amps
RE_AMP = re.compile(
    r'(?:max current|current|max amp|ampere|courant)[:\s]*(\d+\.?\d*)\s*[Aa]',
    re.IGNORECASE,
)

# Power
RE_POWER = re.compile(
    r'(?:max power|power|puissance)[:\s]*(\d+\.?\d*)\s*[Ww]',
    re.IGNORECASE,
)

# Prop / Helice size
RE_PROP = re.compile(
    r'(?:prop(?:eller)?|hélice|helice|recommended prop)[:\s]*(\d+\.?\d*(?:\s*[-–]\s*\d+\.?\d*)?)\s*(?:inch|"|pouce)',
    re.IGNORECASE,
)
RE_PROP_ALT = re.compile(
    r'\b(\d+\.?\d*)\s*(?:inch|")\s*prop',
    re.IGNORECASE,
)

# Mounting pattern
RE_MOUNTING = re.compile(
    r'(?:mounting|mount(?:ing)?\s*pattern|entraxe|hole pattern)[:\s]*(\d+\.?\d*)\s*(?:mm|[xX×]\s*\d+\.?\d*\s*mm)',
    re.IGNORECASE,
)
RE_MOUNTING_FULL = re.compile(
    r'(?:M\d)[:\s]*(\d+\.?\d*)\s*[xX×]\s*(\d+\.?\d*)',
    re.IGNORECASE,
)

# Number of screws
RE_SCREWS = re.compile(
    r'(?:mounting|fix)[:\s]*(\d)\s*(?:vis|screw|bolt|trou|hole)',
    re.IGNORECASE,
)
RE_SCREWS_ALT = re.compile(r'\b(\d)\s*(?:vis|screws?|bolts?)\b', re.IGNORECASE)

# Wire / Cable
RE_WIRE_GAUGE = re.compile(r'\b(\d{1,2})\s*AWG\b', re.IGNORECASE)
RE_CABLE_LENGTH = re.compile(
    r'(?:cable|wire|fil)\s*(?:length|longueur)?[:\s]*(\d+)\s*(?:mm|cm)',
    re.IGNORECASE,
)

# Configuration (poles / magnets)
RE_CONFIG = re.compile(r'\b(\d{1,2})[Nn]\s*(\d{1,2})[Pp]\b')

# Magnet type
RE_MAGNET = re.compile(
    r'(?:magnet|aimant)[:\s]*(N\d{2}\w*|arc|neodymium)',
    re.IGNORECASE,
)

# Brand extraction from text
RE_BRAND_IN_TITLE = re.compile(
    r'^([\w\-]+)\s',
)


def _first_match(pattern: re.Pattern, text: str) -> Optional[str]:
    """Return the first capture group of the first match, or None."""
    m = pattern.search(text)
    return m.group(1) if m else None


def extract_stator_class(text: str) -> Optional[str]:
    """Extract stator size class like '2207', '0802'."""
    # Try explicit mentions first
    m = RE_STATOR.search(text)
    if m:
        return m.group(1)

    # Try diameter x height format
    m = RE_STATOR_SPLIT.search(text)
    if m:
        return m.group(1) + m.group(2)

    # Try plain 4-digit numbers that look like stator sizes
    for m in RE_STATOR_PLAIN.finditer(text):
        val = m.group(1)
        d = int(val[:2])
        h = int(val[2:])
        # Valid stator: diameter 6-32mm, height 2-20mm
        if 6 <= d <= 32 and 2 <= h <= 20:
            return val

    return None


def extract_kv_values(text: str) -> list[str]:
    """Extract all KV values found in text."""
    matches = RE_KV.findall(text)
    # Filter reasonable KV values (500 - 50000)
    return [kv for kv in matches if 500 <= int(kv) <= 50000]


def extract_lipo(text: str) -> str:
    """Extract battery compatibility string."""
    m = RE_LIPO.search(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}".upper()

    singles = RE_LIPO_SINGLE.findall(text)
    if singles:
        unique = sorted(set(s.upper() for s in singles))
        if len(unique) > 1:
            return f"{unique[0]}-{unique[-1]}"
        return unique[0]

    return ""


# Product titles that describe something other than a bare motor
RE_NOT_A_MOTOR = re.compile(
    r'\b(quadcopter|whoop|drone|bnf|pnp|rtf|frame|kit|esc|stack|propellers?|props?|'
    r'flight controller|receiver|goggles?|camera|battery|batteries)\b',
    re.IGNORECASE,
)


def is_motor_title(title: str) -> bool:
    """Reject titles for drones, frames, ESCs... unless they say "motor"."""
    if not title:
        return True
    return bool(re.search(r'motor', title, re.IGNORECASE)) or not RE_NOT_A_MOTOR.search(title)


def detect_brand(*texts: str) -> str:
    """Find a known brand in the title (or URL). Longest names win (e.g. "BrotherHobby" over "Hobby")."""
    for text in texts:
        if not text:
            continue
        norm = re.sub(r'[^a-z0-9]', '', text.lower())
        for brand in sorted(MOTOR_BRANDS, key=len, reverse=True):
            if re.sub(r'[^a-z0-9]', '', brand.lower()) in norm:
                return brand
    return ""


def parse_motor_from_text(
    text: str,
    brand: str = "",
    url: str = "",
    title: str = "",
    image_url: str = "",
) -> list[MotorSpec]:
    """Parse motor specifications from a block of text.

    Returns a list of MotorSpec (one per KV variant found).
    """
    motors = []

    # Clean text
    full_text = f"{title}\n{text}"

    if not is_motor_title(title):
        logger.debug("Skipping non-motor product: %s", title)
        return []

    if title.lower().startswith("collection"):
        logger.debug("Skipping category page: %s", title)
        return []

    if not brand:
        brand = detect_brand(title, url)

    # Extract base specs. The title describes the product itself, while the
    # rest of the page may list related products with other sizes and KVs.
    classe = extract_stator_class(title) or extract_stator_class(full_text)
    title_kvs = extract_kv_values(title)
    kv_values = title_kvs or extract_kv_values(full_text)

    # A page whose title names no size and no KV but lists many KVs is a
    # category/listing page, not a single motor: skip it.
    if not title_kvs and not extract_stator_class(title) and len(set(kv_values)) > 4:
        logger.debug("Skipping listing page: %s", title)
        return []
    weight = _first_match(RE_WEIGHT, full_text) or _first_match(RE_WEIGHT_ALT, full_text)
    shaft_dia = _first_match(RE_SHAFT_DIA, full_text) or _first_match(RE_SHAFT_DIA_ALT, full_text)
    motor_height = _first_match(RE_MOTOR_HEIGHT, full_text)
    motor_dia = _first_match(RE_MOTOR_DIAMETER, full_text)
    lipo = extract_lipo(full_text)
    voltage = _first_match(RE_VOLTAGE, full_text)
    amp = _first_match(RE_AMP, full_text)
    power = _first_match(RE_POWER, full_text)
    prop = _first_match(RE_PROP, full_text) or _first_match(RE_PROP_ALT, full_text)
    mounting = _first_match(RE_MOUNTING, full_text)
    wire_gauge = _first_match(RE_WIRE_GAUGE, full_text)
    cable_length = _first_match(RE_CABLE_LENGTH, full_text)
    magnet = _first_match(RE_MAGNET, full_text)

    # Configuration (e.g. 12N14P)
    config_match = RE_CONFIG.search(full_text)
    config = f"{config_match.group(1)}N{config_match.group(2)}P" if config_match else ""

    # Screws
    screws = _first_match(RE_SCREWS, full_text) or _first_match(RE_SCREWS_ALT, full_text)
    vis_fix = f"{screws} Vis" if screws else ""

    # Stator dimensions from class
    h_stator = ""
    d_stator = ""
    if classe and len(classe) == 4:
        d_stator = classe[:2]
        h_stator = classe[2:]

    # Compute voltage from lipo if not found
    if not voltage and lipo:
        lipo_cells = re.findall(r'(\d)[Ss]', lipo)
        if lipo_cells:
            max_cells = max(int(c) for c in lipo_cells)
            voltage = str(round(max_cells * 3.7, 1))

    # Determine motor name from title
    nom = title.strip() if title else ""
    # Clean common prefixes
    if brand and nom.lower().startswith(brand.lower()):
        nom = nom[len(brand):].strip()
        nom = nom.lstrip("-").lstrip()

    # Wire info
    type_cable = f"{wire_gauge}AWG" if wire_gauge else ""
    l_cable = f"{cable_length}MM" if cable_length else ""

    if not kv_values:
        # No KV found, create single entry if we have stator class
        if classe:
            motor = MotorSpec(
                marque=brand,
                nom=nom,
                classe=classe,
                kv="",
                poids=weight or "",
                h_stator=h_stator,
                d_stator=d_stator,
                h_moteur=motor_height or "",
                d_moteur=motor_dia or "",
                d_shaft=shaft_dia or "",
                type_shaft="Tige" if shaft_dia else "",
                vis_fix=vis_fix,
                entraxe_fix=mounting or "",
                lipo=lipo,
                voltage=voltage or "",
                l_cable=l_cable,
                type_cable=type_cable,
                helice=prop or "",
                puissance=power or "",
                amp=amp or "",
                aimant=magnet or "",
                config=config,
                lien=url,
                img=image_url,
                source_url=url,
            )
            motor.generate_ref()
            motors.append(motor)
    else:
        for kv in kv_values:
            motor = MotorSpec(
                marque=brand,
                nom=nom,
                classe=classe or "",
                kv=kv,
                poids=weight or "",
                h_stator=h_stator,
                d_stator=d_stator,
                h_moteur=motor_height or "",
                d_moteur=motor_dia or "",
                d_shaft=shaft_dia or "",
                type_shaft="Tige" if shaft_dia else "",
                vis_fix=vis_fix,
                entraxe_fix=mounting or "",
                lipo=lipo,
                voltage=voltage or "",
                l_cable=l_cable,
                type_cable=type_cable,
                helice=prop or "",
                puissance=power or "",
                amp=amp or "",
                aimant=magnet or "",
                config=config,
                lien=url,
                img=image_url,
                source_url=url,
            )
            motor.generate_ref()
            motors.append(motor)

    return motors


def parse_product_listing(
    title: str,
    description: str = "",
    brand: str = "",
    url: str = "",
    image_url: str = "",
    specs_table: Optional[dict] = None,
) -> list[MotorSpec]:
    """Parse a product listing page into motor specs.

    Args:
        title: Product title
        description: Full product description text
        brand: Known brand name
        url: Product URL
        image_url: Product image URL
        specs_table: Optional dict of specification key-value pairs

    Returns:
        List of MotorSpec objects
    """
    # Build combined text from all sources
    text_parts = [title, description]

    if specs_table:
        for key, value in specs_table.items():
            text_parts.append(f"{key}: {value}")

    combined_text = "\n".join(text_parts)

    return parse_motor_from_text(
        text=combined_text,
        brand=brand,
        url=url,
        title=title,
        image_url=image_url,
    )
