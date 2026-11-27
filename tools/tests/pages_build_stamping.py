import importlib.util
import tempfile
import unittest
from pathlib import Path


BUILD_SCRIPT = Path(__file__).resolve().parents[1] / "pages_build.py"
spec = importlib.util.spec_from_file_location("pages_build", BUILD_SCRIPT)
pages_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages_build)


class PagesBuildStampingTests(unittest.TestCase):
    def test_mjs_files_and_their_relative_imports_are_stamped(self):
        build_id = "pages-0123456789abcdef"
        self.assertIn(".mjs", pages_build.STAMPED_SUFFIXES)
        with tempfile.TemporaryDirectory() as temp_dir:
            module = Path(temp_dir) / "healthbar-settings.mjs"
            module.write_text(
                "import { UI } from './ui.js';\n"
                "import { G } from '../state.js';\n",
                encoding="utf-8",
            )

            changed = pages_build.rewrite_text(module, build_id)

            self.assertEqual(changed, 2)
            rewritten = module.read_text(encoding="utf-8")
            self.assertIn("'./ui.js?v=pages-0123456789abcdef'", rewritten)
            self.assertIn("'../state.js?v=pages-0123456789abcdef'", rewritten)

    def test_deployment_excludes_maintainer_material_but_keeps_runtime_textures(self):
        root = pages_build.ROOT

        self.assertNotIn("tools", pages_build.deployment_ignore(str(root), ["tools", "index.html"]))
        self.assertEqual(
            pages_build.deployment_ignore(
                str(root / "tools"), ["sea3d.js", "airship3d.js", "tests", "pages_build.py"]
            ),
            {"tests", "pages_build.py"},
        )
        self.assertIn("FinalClasses", pages_build.deployment_ignore(str(root / "assets"), ["FinalClasses", "tiles"]))
        source_ignored = pages_build.deployment_ignore(
            str(root / "assets/source"), ["biomes", "audio", "airship", "castle3d"]
        )
        self.assertEqual(source_ignored, {"biomes", "audio"})
        airship_ignored = pages_build.deployment_ignore(
            str(root / "assets/source/airship"), ["textures", "atlases", "qa", "README.md"]
        )
        self.assertEqual(airship_ignored, {"atlases", "qa", "README.md"})
        castle_ignored = pages_build.deployment_ignore(
            str(root / "assets/source/castle3d"), ["tex", "source_art"]
        )
        self.assertEqual(castle_ignored, {"source_art"})


if __name__ == "__main__":
    unittest.main()
