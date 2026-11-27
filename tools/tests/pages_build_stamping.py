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


if __name__ == "__main__":
    unittest.main()
