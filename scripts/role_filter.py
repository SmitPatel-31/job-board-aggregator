"""
Role preset matcher, shared by the pipeline.

Reads data/role_filter.json (the same file js/role_filter.js reads) and decides
whether a job belongs to the target role families. Used by build_shortlist.py to
pick which companies the hourly fast-tier scrape should hit.

Include/exclude patterns are combined into one alternation each so matching stays
cheap when run across ~1M jobs.
"""

import json
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_FILE = os.path.join(ROOT_DIR, "data", "role_filter.json")


def load_config(path=CONFIG_FILE):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def compile_config(cfg):
    """Compile the config into (include_re, exclude_re, levels)."""
    include = re.compile("|".join(cfg["include"]), re.IGNORECASE)
    exclude = (
        re.compile("|".join(cfg["exclude"]), re.IGNORECASE)
        if cfg.get("exclude")
        else None
    )
    return include, exclude, set(cfg.get("levels") or [])


def matches(job, compiled):
    """True if the job is one of the target roles at one of the target levels."""
    include, exclude, levels = compiled
    title = job.get("title") or ""
    if not title:
        return False
    if levels and (job.get("skill_level") or "") not in levels:
        return False
    if not include.search(title):
        return False
    if exclude and exclude.search(title):
        return False
    return True
