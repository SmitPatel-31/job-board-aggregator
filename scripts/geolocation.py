# geolocation.py
"""
Reusable geolocation module.
Parses job posting location strings and looks up coordinates.

Usage:
    from geolocation import build_lookup, lookup_location

    maps = build_lookup("data/locations.json")
    result = lookup_location("San Francisco, CA", maps)
    # result => {"remote": False, "coords": [37.7749, -122.4194]}
"""

import json
import re
import unicodedata
from pathlib import Path


# ---- Constants ----

REMOTE_KEYWORDS = {
    "remote",
    "anywhere",
    "worldwide",
    "work from home",
    "wfh",
}

TIMEZONE_KEYWORDS = {
    "time zone",
    "timezone",
    "time zones",
    "timezones",
}

GARBAGE_LOCATIONS = {
    "",
    "not specified",
    "n/a",
    "none",
    "tbd",
    "unspecified",
    "multiple locations",
    "various",
    "flexible",
    "other",
    "global",
    "multiple",
    "varies",
    "various locations",
    "2 locations",
    "3 locations",
    "4 locations",
    "5 locations",
    "6 locations",
    "7 locations",
    "8 locations",
    "9 locations",
    "10 locations",
}

WORK_ARRANGEMENT_PREFIXES = [
    "hybrid in ",
    "hybrid - ",
    "hybrid: ",
    "hybrid, ",
    "on-site in ",
    "on site in ",
    "onsite in ",
    "in-office in ",
    "in office in ",
    "based in ",
    "located in ",
]

DIRECTION_EXPANSIONS = {
    " n ": " north ",
    " s ": " south ",
    " e ": " east ",
    " w ": " west ",
    " nw ": " northwest ",
    " ne ": " northeast ",
    " sw ": " southwest ",
    " se ": " southeast ",
}

ABBREVIATION_EXPANSIONS = {
    " ft ": " fort ",
    " mt ": " mount ",
    " pt ": " port ",
}

COUNTRY_ALIASES = {
    # North America
    "us": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US",
    "united states": "US", "united states of america": "US", "america": "US",
    # "ca": "CA",  # collides with California - use "can"/"canada" instead
    "can": "CA", "canada": "CA",
    "mx": "MX", "mex": "MX", "mexico": "MX",
    # UK / Ireland
    "gb": "GB", "gbr": "GB", "uk": "GB", "u.k.": "GB",
    "united kingdom": "GB", "england": "GB", "scotland": "GB",
    "wales": "GB", "northern ireland": "GB", "britain": "GB", "great britain": "GB",
    "ie": "IE", "irl": "IE", "ireland": "IE",
    # Europe
    # "de": "DE",  # collides with Delaware
    "deu": "DE", "ger": "DE", "germany": "DE", "deutschland": "DE",
    "fr": "FR", "fra": "FR", "france": "FR",
    "es": "ES", "esp": "ES", "spain": "ES",
    "it": "IT", "ita": "IT", "italy": "IT",
    "nl": "NL", "nld": "NL", "netherlands": "NL", "holland": "NL",
    "be": "BE", "bel": "BE", "belgium": "BE",
    "ch": "CH", "che": "CH", "switzerland": "CH",
    "at": "AT", "aut": "AT", "austria": "AT",
    "se": "SE", "swe": "SE", "sweden": "SE",
    "no": "NO", "nor": "NO", "norway": "NO",
    "dk": "DK", "dnk": "DK", "denmark": "DK",
    "fi": "FI", "fin": "FI", "finland": "FI",
    "pl": "PL", "pol": "PL", "poland": "PL",
    "pt": "PT", "prt": "PT", "portugal": "PT",
    "cz": "CZ", "cze": "CZ", "czech republic": "CZ", "czechia": "CZ",
    "gr": "GR", "grc": "GR", "greece": "GR",
    "ro": "RO", "rou": "RO", "romania": "RO",
    "ua": "UA", "ukr": "UA", "ukraine": "UA",
    # Asia / Pacific
    # "in": "IN",  # collides with Indiana
    "ind": "IN", "india": "IN",
    "cn": "CN", "chn": "CN", "china": "CN",
    "jp": "JP", "jpn": "JP", "japan": "JP",
    "kr": "KR", "kor": "KR", "korea": "KR", "south korea": "KR",
    "sg": "SG", "sgp": "SG", "singapore": "SG",
    "my": "MY", "mys": "MY", "malaysia": "MY",
    "ph": "PH", "phl": "PH", "philippines": "PH",
    # "id": "ID",  # collides with Idaho
    "idn": "ID", "indonesia": "ID",
    "th": "TH", "tha": "TH", "thailand": "TH",
    "vn": "VN", "vnm": "VN", "vietnam": "VN",
    "hk": "HK", "hkg": "HK", "hong kong": "HK",
    "tw": "TW", "twn": "TW", "taiwan": "TW",
    "au": "AU", "aus": "AU", "australia": "AU",
    "nz": "NZ", "nzl": "NZ", "new zealand": "NZ",
    # Middle East / Africa
    # "il": "IL",  # collides with Illinois
    "isr": "IL", "israel": "IL",
    "ae": "AE", "are": "AE", "united arab emirates": "AE", "uae": "AE",
    # "sa": "SA",  # SA isn't a US state but keeping lowercase-only reduces risk
    "sau": "SA", "saudi arabia": "SA",
    "tr": "TR", "tur": "TR", "turkey": "TR",
    "za": "ZA", "zaf": "ZA", "south africa": "ZA",
    "eg": "EG", "egy": "EG", "egypt": "EG",
    "ng": "NG", "nga": "NG", "nigeria": "NG",
    "ke": "KE", "ken": "KE", "kenya": "KE",
    # South America
    "br": "BR", "bra": "BR", "brazil": "BR", "brasil": "BR",
    "ar": "AR", "arg": "AR", "argentina": "AR",
    "cl": "CL", "chl": "CL", "chile": "CL",
    # "co": "CO",  # collides with Colorado
    "col": "CO", "colombia": "CO",
    "pe": "PE", "per": "PE", "peru": "PE",
}

US_STATES = {
    "al": "AL",
    "alabama": "AL",
    "ak": "AK",
    "alaska": "AK",
    "az": "AZ",
    "arizona": "AZ",
    "ar": "AR",
    "arkansas": "AR",
    "ca": "CA",
    "california": "CA",
    "co": "CO",
    "colorado": "CO",
    "ct": "CT",
    "connecticut": "CT",
    "de": "DE",
    "delaware": "DE",
    "fl": "FL",
    "florida": "FL",
    "ga": "GA",
    "georgia": "GA",
    "hi": "HI",
    "hawaii": "HI",
    "id": "ID",
    "idaho": "ID",
    "il": "IL",
    "illinois": "IL",
    "in": "IN",
    "indiana": "IN",
    "ia": "IA",
    "iowa": "IA",
    "ks": "KS",
    "kansas": "KS",
    "ky": "KY",
    "kentucky": "KY",
    "la": "LA",
    "louisiana": "LA",
    "me": "ME",
    "maine": "ME",
    "md": "MD",
    "maryland": "MD",
    "ma": "MA",
    "massachusetts": "MA",
    "mi": "MI",
    "michigan": "MI",
    "mn": "MN",
    "minnesota": "MN",
    "ms": "MS",
    "mississippi": "MS",
    "mo": "MO",
    "missouri": "MO",
    "mt": "MT",
    "montana": "MT",
    "ne": "NE",
    "nebraska": "NE",
    "nv": "NV",
    "nevada": "NV",
    "nh": "NH",
    "new hampshire": "NH",
    "nj": "NJ",
    "new jersey": "NJ",
    "nm": "NM",
    "new mexico": "NM",
    "ny": "NY",
    "new york": "NY",
    "nc": "NC",
    "north carolina": "NC",
    "nd": "ND",
    "north dakota": "ND",
    "oh": "OH",
    "ohio": "OH",
    "ok": "OK",
    "oklahoma": "OK",
    "or": "OR",
    "oregon": "OR",
    "pa": "PA",
    "pennsylvania": "PA",
    "ri": "RI",
    "rhode island": "RI",
    "sc": "SC",
    "south carolina": "SC",
    "sd": "SD",
    "south dakota": "SD",
    "tn": "TN",
    "tennessee": "TN",
    "tx": "TX",
    "texas": "TX",
    "ut": "UT",
    "utah": "UT",
    "vt": "VT",
    "vermont": "VT",
    "va": "VA",
    "virginia": "VA",
    "wa": "WA",
    "washington": "WA",
    "wv": "WV",
    "west virginia": "WV",
    "wi": "WI",
    "wisconsin": "WI",
    "wy": "WY",
    "wyoming": "WY",
    "dc": "DC",
    "d c": "DC",
    "district of columbia": "DC",
    "washington dc": "DC",
    "washington d c": "DC",
}

# City aliases — normalized input → form that matches GeoNames asciiname
# Direction: job posting says X → look it up as Y in locations.json
CITY_ALIASES = {
    # India — GeoNames uses modern official names
    "bangalore": "bengaluru",
    "bombay": "mumbai",
    "madras": "chennai",
    "calcutta": "kolkata",
    # China
    "peking": "beijing",
    # Common US disambiguations / abbreviations
    "new york": "new york city",
    "nyc": "new york city",
    "ny city": "new york city",
    "la": "los angeles",
    "sf": "san francisco",
    "san fran": "san francisco",
    # UK special
    "london city of": "london",
    "city of london": "london",
    # Metro areas → main city
    "bay area": "san francisco",
    "sf bay area": "san francisco",
    "san francisco bay area": "san francisco",
    "greater boston": "boston",
    "boston metro": "boston",
    "nyc metro": "new york city",
    "ny metro": "new york city",
    "greater new york": "new york city",
    "new york metro": "new york city",
    "dc metro": "washington",
    "washington metro": "washington",
    "la metro": "los angeles",
    "greater los angeles": "los angeles",
    "greater chicago": "chicago",
    "chicago metro": "chicago",
    "greater seattle": "seattle",
    "seattle metro": "seattle",
    "greater london": "london",
    "london metro": "london",
}

NYC_BOROUGHS = {
    "bronx", "brooklyn", "queens", "staten island", "manhattan",
}

JUNK_TOKEN_SUFFIXES = {
    "hq",
    "office",
    "headquarters",
    "hub",
    "campus",
    "location",
    "site",
    "center",
    "centre",
    "area",
    "township",
    "twp",
}

FAMOUS_CITY_DEFAULTS = {
    # city_name → country code. Used only when city appears alone.
    "london": "GB",
    "paris": "FR",
    "san francisco": "US",
    "moscow": "RU",
    "berlin": "DE",
    "madrid": "ES",
    "rome": "IT",
    "sydney": "AU",
    "toronto": "CA",
    "dublin": "IE",
    "athens": "GR",
    "vienna": "AT",
    "cairo": "EG",
    "boston": "US",
    "chicago": "US",
    "seattle": "US",
    "denver": "US",
    "portland": "US",  # Portland OR, not Portland ME
    "columbus": "US",
    "richmond": "US",
    "springfield": "US",
    # Large US cities that share a name with a smaller foreign city. Without
    # these, the city-only fallback picked whichever row appeared first in
    # locations.json, which sent "Los Angeles" to Chile, "Houston" to British
    # Columbia, "Dallas" to Melbourne and "San Jose" to Argentina -- wrong
    # country AND wrong heatmap coordinates. Measured at ~2,400 affected jobs.
    "los angeles": "US",
    "san diego": "US",
    "san jose": "US",  # San Jose CA, not San José Argentina/Costa Rica
    "santa clara": "US",
    "dallas": "US",
    "houston": "US",
    "miami": "US",
    "cleveland": "US",
    "sacramento": "US",
    "rochester": "US",
    "albany": "US",
    "arlington": "US",
    "salem": "US",
    "phoenix": "US",
    "atlanta": "US",
    "detroit": "US",
    "baltimore": "US",
    "milwaukee": "US",
    "nashville": "US",
    "memphis": "US",
    "pittsburgh": "US",
    "cincinnati": "US",
    "minneapolis": "US",
    "philadelphia": "US",
    # Deliberately NOT listed: birmingham, manchester, cambridge, york.
    # Those genuinely favour the UK, so guessing US would be worse.
}

# Pinning the country alone isn't enough for coords: several of these names also
# belong to small US towns, and the city-only fallback would happily return
# Houston, Missouri or San Jose, Illinois. locations.json carries no population
# column to break the tie, so the intended state is named explicitly. Keyed the
# same as FAMOUS_CITY_DEFAULTS; only needed where the largest city isn't the
# first matching row.
FAMOUS_CITY_ADMIN = {
    "houston": "tx",
    "dallas": "tx",
    "san jose": "ca",
    "san diego": "ca",
    "santa clara": "ca",
    "los angeles": "ca",
    "sacramento": "ca",
    "arlington": "va",
    "albany": "ny",
    "rochester": "ny",
    "salem": "or",
    "portland": "or",
    "columbus": "oh",
    "cleveland": "oh",
    "cincinnati": "oh",
    "richmond": "va",
    "springfield": "il",
    "miami": "fl",
    "phoenix": "az",
    "atlanta": "ga",
    "detroit": "mi",
    "baltimore": "md",
    "milwaukee": "wi",
    "nashville": "tn",
    "memphis": "tn",
    "pittsburgh": "pa",
    "philadelphia": "pa",
    "minneapolis": "mn",
    "denver": "co",
    "seattle": "wa",
    "boston": "ma",
    "chicago": "il",
    "san francisco": "ca",
}


# ---- Normalization ----


def normalize(s):
    """Lowercase, strip diacritics, strip punctuation, normalize saint/directions/abbrevs, collapse whitespace."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    for ch in [".", "'", "`"]:
        s = s.replace(ch, "")
    s = " ".join(s.lower().split())

    if s.startswith("saint "):
        s = "st " + s[6:]
    s = s.replace(" saint ", " st ")

    padded = f" {s} "
    for abbrev, full in DIRECTION_EXPANSIONS.items():
        padded = padded.replace(abbrev, full)
    for abbrev, full in ABBREVIATION_EXPANSIONS.items():
        padded = padded.replace(abbrev, full)
    s = padded.strip()

    return s


# ---- Remote detection ----


def is_remote(location_str):
    """True if the location string indicates a remote job."""
    if not location_str:
        return False
    s = normalize(location_str)
    if s in GARBAGE_LOCATIONS:
        return False
    return any(kw in s for kw in REMOTE_KEYWORDS)


# ---- Country / admin / city extraction ----


def extract_country(tokens):
    if len(tokens) <= 1:
        return None, tokens
    for i in range(len(tokens) - 1, -1, -1):
        t = tokens[i]
        if t in COUNTRY_ALIASES:
            return COUNTRY_ALIASES[t], tokens[:i] + tokens[i + 1 :]
    return None, tokens


def extract_us_state(tokens):
    if len(tokens) <= 1:
        return None, tokens
    for i in range(len(tokens) - 1, -1, -1):
        t = tokens[i]
        if t in US_STATES:
            return US_STATES[t], tokens[:i] + tokens[i + 1 :]
    return None, tokens


def clean_token(t):
    """Strip trailing junk words from a token."""
    words = t.split()
    while words and words[-1] in JUNK_TOKEN_SUFFIXES:
        words.pop()
    return " ".join(words)


def strip_work_arrangement(normalized):
    for prefix in WORK_ARRANGEMENT_PREFIXES:
        if normalized.startswith(prefix):
            return normalized[len(prefix) :]
    return normalized


# "Polaris, OH 43210" -- a US state abbreviation followed by a ZIP. Some ATSes
# put raw street addresses in the location field, which the gazetteer can't
# match, but the state+ZIP pair is distinctive enough to pin the country.
US_STATE_ZIP_RE = re.compile(r"\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b")


def _country_from_address(location_str):
    """Recover US from a free-text street address, or None."""
    match = US_STATE_ZIP_RE.search(location_str or "")
    if match and match.group(1).lower() in US_STATES:
        return "US"
    return None


# Country aliases of 3+ characters, longest first so "united states of america"
# wins over "united states". Deliberately excludes 2-letter codes: matching
# those as bare words across free text turns "Berlin, DE" into Delaware and
# "Cork, IN" into Indiana. Longer aliases are unambiguous enough to trust.
_LONG_ALIASES = sorted((a for a in COUNTRY_ALIASES if len(a) >= 3), key=len, reverse=True)
LONG_ALIAS_RE = re.compile(
    r"\b(" + "|".join(re.escape(a) for a in _LONG_ALIASES) + r")\b", re.IGNORECASE
)

# Delimiters used by ATS location strings that aren't commas:
# "USA-Illinois-Chicago", "San Francisco, CA • New York, NY • United States"
_DELIMITERS = re.compile(r"[,\-–—•|/]+")


def _country_from_freetext(location_str):
    """Last-resort country scan over a location string the gazetteer missed.

    Handles the dash- and bullet-separated formats several ATSes emit, where the
    country is spelled out but never lands in a comma-delimited position the
    main parser inspects -- e.g. "United States - Illinois - Lake Forest".
    Measured at ~12.7k jobs that were otherwise country-less.
    """
    if not location_str:
        return None

    # Exact token match first: most precise.
    for part in _DELIMITERS.split(location_str):
        token = " ".join(part.split()).lower()
        if token in COUNTRY_ALIASES:
            return COUNTRY_ALIASES[token]

    # Then a word-boundary search for spelled-out names ("Wilmington NC USA").
    match = LONG_ALIAS_RE.search(location_str)
    if match:
        return COUNTRY_ALIASES[match.group(1).lower()]
    return None


def _country_from_remote(normalized):
    """Best-effort country for a remote posting ("Remote - US", "Remote, Canada").

    parse_job_location bails out as soon as it sees a remote keyword, so the
    country token in these strings used to be discarded entirely. That made
    "Remote - US" invisible to a US-only filter despite being one of the most
    common location strings in the dataset.

    Only the country is recovered here; city and admin stay unset so coords and
    the heatmap behave exactly as before.

    Note: 'ar' is both Argentina and Arkansas. Country aliases are checked
    first, so it resolves to AR-the-country. It's the only such collision
    between COUNTRY_ALIASES and US_STATES.
    """
    text = normalized
    for kw in REMOTE_KEYWORDS | TIMEZONE_KEYWORDS:
        text = text.replace(kw, " ")

    for part in re.split(r"[,\-—|/()]", text):
        token = " ".join(part.split())
        if not token:
            continue
        if token in COUNTRY_ALIASES:
            return COUNTRY_ALIASES[token]
        if token in US_STATES:
            return "US"
    return None


def parse_job_location(location_str):
    result = {"remote": False, "city": None, "admin": None, "country": None}

    if not location_str:
        return result

    normalized = normalize(location_str)

    if not normalized or normalized in GARBAGE_LOCATIONS:
        return result

    if any(kw in normalized for kw in REMOTE_KEYWORDS):
        result["remote"] = True
        result["country"] = _country_from_remote(normalized)
        return result

    if any(kw in normalized for kw in TIMEZONE_KEYWORDS):
        result["remote"] = True
        result["country"] = _country_from_remote(normalized)
        return result

    normalized = strip_work_arrangement(normalized)
    
    # Strip parenthetical suffixes: "(HQ)", "(Main Office)", "(Remote)", etc.
    normalized = re.sub(r'\s*\([^)]*\)\s*', ' ', normalized).strip()
    
    for pattern in ["- remote", "— remote"]:
        normalized = normalized.replace(pattern, "")
    normalized = normalized.strip(" ,-—")

    if not normalized:
        return result

    tokens = [clean_token(t.strip()) for t in normalized.split(",") if t.strip()]
    tokens = [t for t in tokens if t]

    if not tokens:
        return result

    # Dedupe consecutive identical tokens
    deduped = []
    for t in tokens:
        if not deduped or deduped[-1] != t:
            deduped.append(t)
    tokens = deduped

    joined = " ".join(tokens)
    if joined in CITY_ALIASES:
        result["city"] = CITY_ALIASES[joined]
        return result

    # Handle "city state" space-separated patterns
    if len(tokens) == 1:
        words = tokens[0].split()
        if len(words) >= 2 and words[-1] in US_STATES:
            state = words[-1]
            city = " ".join(words[:-1])
            tokens = [city, state]
    
    # NEW: Single-token country-only case (e.g. "US", "UK", "France")
    # This must come BEFORE extract_country which bails on single tokens
    if len(tokens) == 1 and tokens[0] in COUNTRY_ALIASES:
        result["country"] = COUNTRY_ALIASES[tokens[0]]
        # No city — just a country. Return with country set, no coords will match.
        return result

    country, tokens = extract_country(tokens)
    result["country"] = country


    if country == "US" or country is None:
        state, tokens_after_state = extract_us_state(tokens)
        if state:
            result["admin"] = state
            tokens = tokens_after_state
            if country is None:
                result["country"] = "US"

    if tokens:
        if result["admin"] is None and len(tokens) >= 2:
            result["admin"] = tokens[-1]
            result["city"] = " ".join(tokens[:-1])
        elif len(tokens) == 1:
            result["city"] = tokens[0]
        else:
            result["city"] = tokens[0]

    if result["city"] and result["city"] in CITY_ALIASES:
        result["city"] = CITY_ALIASES[result["city"]]

    return result


# ---- Build lookup maps ----


def build_lookup(locations_path):
    with open(locations_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    schema = payload["schema"]
    data = payload["data"]

    CITY = schema.index("city")
    ADMIN = schema.index("admin")
    COUNTRY = schema.index("country")
    LAT = schema.index("lat")
    LNG = schema.index("lng")

    maps = {
        "city_admin_country": {},
        "city_country": {},
        "city_admin": {},
        "city": {},
        # city -> ISO country code, so a city-only match can still report a
        # country for the frontend's region filter
        "city_to_country": {},
    }

    for row in data:
        city_n = normalize(row[CITY])
        admin_n = normalize(row[ADMIN])  # normalized lowercase
        country = row[COUNTRY]
        coords = [row[LAT], row[LNG]]

        if not city_n:
            continue

        if admin_n and country:
            key = f"{city_n}|{admin_n}|{country}"
            maps["city_admin_country"].setdefault(key, coords)

        if country:
            key = f"{city_n}|{country}"
            maps["city_country"].setdefault(key, coords)

        if admin_n:
            key = f"{city_n}|{admin_n}"
            maps["city_admin"].setdefault(key, coords)

        maps["city"].setdefault(city_n, coords)
        if country:
            maps["city_to_country"].setdefault(city_n, country)

    return maps


# ---- Main lookup function ----


def lookup_location(location_str, maps):
    """Resolve a raw location string to {remote, coords, country}.

    country is an ISO 3166-1 alpha-2 code, or None when it can't be determined.
    It's returned even when coords resolution fails, because the frontend's
    region filter only needs the country -- knowing a job is in the US is useful
    even if the exact city never matched the gazetteer.
    """
    parsed = parse_job_location(location_str)

    # An explicit country survives a remote match ("Remote - US", "Remote, Canada").
    if parsed["remote"]:
        return {"remote": True, "coords": None, "country": parsed["country"]}

    city = parsed["city"]
    admin = parsed["admin"].lower() if parsed["admin"] else None
    country = parsed["country"]

    if not city:
        return {
            "remote": False,
            "coords": None,
            "country": country or _country_from_freetext(location_str),
        }

    # Map NYC boroughs to New York City (only when admin explicitly NY)
    if city in NYC_BOROUGHS and admin == "ny":
        city = "new york city"

    # parse_job_location treats any 2-letter US state token as implying the US,
    # which misreads foreign 2-letter codes -- "Berlin, DE" becomes Delaware,
    # "Cork, IE" would become... nothing sensible. When the gazetteer has no
    # such city in that US state but does know the city in another country,
    # trust the gazetteer over the abbreviation.
    if country == "US" and admin and len(admin) == 2:
        if not maps["city_admin_country"].get(f"{city}|{admin}|US"):
            known = maps["city_to_country"].get(city)
            if known and known != "US":
                country = known

    if city and admin and country:
        coords = maps["city_admin_country"].get(f"{city}|{admin}|{country}")
        if coords:
            return {"remote": False, "coords": coords, "country": country}

    if city and country:
        coords = maps["city_country"].get(f"{city}|{country}")
        if coords:
            return {"remote": False, "coords": coords, "country": country}

    if city and admin:
        coords = maps["city_admin"].get(f"{city}|{admin}")
        if coords:
            return {
                "remote": False,
                "coords": coords,
                "country": country or maps["city_to_country"].get(city),
            }

    # NEW: famous-city default before city-only fallback
    if city in FAMOUS_CITY_DEFAULTS and not country:
        default_country = FAMOUS_CITY_DEFAULTS[city]
        # Prefer the explicitly pinned state so coords land on the large city
        # rather than a same-named small town in another state.
        default_admin = FAMOUS_CITY_ADMIN.get(city)
        if default_admin:
            coords = maps["city_admin_country"].get(
                f"{city}|{default_admin}|{default_country}"
            )
            if coords:
                return {
                    "remote": False,
                    "coords": coords,
                    "country": default_country,
                }
        coords = maps["city_country"].get(f"{city}|{default_country}")
        if coords:
            return {"remote": False, "coords": coords, "country": default_country}

    coords = maps["city"].get(city)
    if coords:
        return {
            "remote": False,
            "coords": coords,
            "country": country or maps["city_to_country"].get(city),
        }

    return {
        "remote": False,
        "coords": None,
        "country": (
            country
            or maps["city_to_country"].get(city)
            or _country_from_address(location_str)
            or _country_from_freetext(location_str)
        ),
    }