#!/usr/bin/env python3
"""Prepare a commit-stamped, cache-safe GitHub Pages artifact for Velscour PC."""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.8"
STAMPED_SUFFIXES = {".js", ".mjs", ".html", ".css"}
ASSET_EXTENSIONS = (
    "m?js|css|html|webp|png|jpe?g|gif|svg|mp3|ogg|wav|mp4|webm|json|atlas|bin|glb|gltf|woff2?"
)
LOCAL_REFERENCE = re.compile(
    rf"(?P<quote>[\"'`])(?P<url>(?:\.{1,2}/)*(?:assets|vendor|css)/[^\"'`\r\n]*?\.(?:{ASSET_EXTENSIONS}))(?P=quote)",
    re.IGNORECASE,
)
RELATIVE_MODULE = re.compile(
    r"(?P<quote>[\"'`])(?P<url>(?:\.{1,2}/)[^\"'`\r\n]*?\.m?js)(?P=quote)"
)
THREE_ADDON_MODULE = re.compile(
    r"(?P<quote>[\"'`])(?P<url>three/addons/[^\"'`\r\n]*?\.m?js)(?P=quote)"
)
CSS_URL = re.compile(r"url\(\s*(?P<quote>[\"']?)(?P<url>[^\"')]+)(?P=quote)\s*\)", re.IGNORECASE)


def deployment_ignore(directory: str, names: list[str]) -> set[str]:
    """Exclude development/source material while retaining runtime assets.

    Keep source texture directories that are loaded directly by the optional
    3D airship/castle scenes. The original art packs and generator outputs are
    in git for maintainers, but are not requested by the browser game.
    """
    base = Path(directory).resolve()
    relative = base.relative_to(ROOT)
    ignored = {
        ".git", ".github", "node_modules", "__pycache__", ".pytest_cache",
        "_site", "docs", "source_art", "reference_sheets", "qa",
        "template", "SHA256SUMS.txt",
    }
    excluded = {name for name in names if name in ignored}

    # A few scene modules live in tools/ but are imported by the game at
    # runtime. Keep those modules; omit test suites and authoring utilities.
    if relative == Path("tools"):
        runtime_modules = {
            "sea3d.js", "seaship3d.js", "seaship3d_dawnwake.js",
            "seaship3d_small.js", "airship3d.js", "airship3d_ironclad.js",
            "airship3d_skiffs.js",
        }
        excluded.update(name for name in names if name not in runtime_modules)
    elif relative != Path(".") and "tools" in names:
        excluded.add("tools")

    if relative == Path("assets"):
        excluded.add("FinalClasses")
    elif relative == Path("assets/source"):
        excluded.update(name for name in names if name not in {"airship", "castle3d"})
    elif relative == Path("assets/source/airship"):
        excluded.update(name for name in names if name != "textures")
    elif relative == Path("assets/source/castle3d"):
        excluded.update(name for name in names if name != "tex")

    # Project notes and local helper scripts are not part of the game UI.
    for name in names:
        path = base / name
        if path.is_file() and path.suffix.lower() in {".md", ".cmd", ".rules"}:
            excluded.add(name)
    return excluded


def add_build_query(url: str, build_id: str) -> str:
    if not url or url.startswith(("data:", "blob:", "http:", "https:", "//", "#")):
        return url
    if re.search(r"(?:[?&])(?:v|build)=", url):
        return url
    clean, marker, fragment = url.partition("#")
    separator = "&" if "?" in clean else "?"
    result = f"{clean}{separator}v={build_id}"
    return f"{result}#{fragment}" if marker else result


def rewrite_text(path: Path, build_id: str) -> int:
    text = path.read_text(encoding="utf-8")
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        url = match.group("url")
        revised = add_build_query(url, build_id)
        if revised != url:
            count += 1
        return f"{match.group('quote')}{revised}{match.group('quote')}"

    # Version every relative ESM import in the graph, plus literal local resource
    # references in scripts, HTML, and stylesheets. This defeats old HTTP cache
    # entries after an update without touching browser storage.
    text = RELATIVE_MODULE.sub(replace, text)
    text = THREE_ADDON_MODULE.sub(replace, text)
    text = LOCAL_REFERENCE.sub(replace, text)

    if path.suffix.lower() == ".css":
        def replace_css(match: re.Match[str]) -> str:
            nonlocal count
            url = match.group("url").strip()
            revised = add_build_query(url, build_id)
            if revised != url:
                count += 1
            quote = match.group("quote")
            return f"url({quote}{revised}{quote})"

        text = CSS_URL.sub(replace_css, text)

    if path.name == "index.html":
        text = text.replace("__VELSCOUR_BUILD_ID__", build_id)
        text = text.replace("VELSCOUR_GIT_COMMIT_PLACEHOLDER", build_id.removeprefix("pages-"))

    if path.as_posix().endswith("src/data/build-version.js"):
        text = re.sub(
            r"export\s+const\s+GAME_BUILD_ID\s*=\s*(['\"]).*?\1\s*;",
            f"export const GAME_BUILD_ID = '{build_id}';",
            text,
        )
        text = re.sub(
            r"export\s+const\s+GAME_GIT_COMMIT\s*=\s*(['\"]).*?\1\s*;",
            f"export const GAME_GIT_COMMIT = '{build_id.removeprefix('pages-')}';",
            text,
        )

    path.write_text(text, encoding="utf-8", newline="")
    return count


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: pages_build.py OUTPUT_DIR FULL_GIT_COMMIT_SHA")
    output = Path(sys.argv[1]).resolve()
    commit = sys.argv[2].strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("Expected a full 40-character Git commit SHA")
    if output == ROOT or ROOT in output.parents:
        raise SystemExit("Output directory must not be inside the source tree")

    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(
        ROOT,
        output,
        ignore=deployment_ignore,
    )
    build_id = f"pages-{commit}"
    updated = 0
    for path in output.rglob("*"):
        if path.is_file() and path.suffix.lower() in STAMPED_SUFFIXES:
            updated += rewrite_text(path, build_id)
    version_file = output / "src/data/build-version.js"
    version_text = version_file.read_text(encoding="utf-8")
    if f"GAME_BUILD_ID = '{build_id}'" not in version_text:
        raise SystemExit("Could not stamp the build identity into the published version module")
    print(f"Prepared Pages build {VERSION} / {build_id}; versioned {updated} local references.")


if __name__ == "__main__":
    main()
