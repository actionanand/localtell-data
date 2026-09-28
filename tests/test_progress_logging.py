import io, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
from progress_logging import ProgressReporter

class ProgressLoggingTests(unittest.TestCase):
    def test_disabled_reporter_is_silent(self):
        lines = []; reporter = ProgressReporter(False, "west", emit=lambda message, flush=True: lines.append(message))
        with reporter.phase("Relation-index pass"): pass
        self.assertEqual([], lines)
    def test_phase_reports_and_heartbeat_thread_stops(self):
        lines = []; reporter = ProgressReporter(True, "west", interval=0.01, emit=lambda message, flush=True: lines.append(message))
        with reporter.phase("Relation-index pass") as phase:
            phase.stop.wait(0.02)
        self.assertFalse(phase.thread.is_alive())
        self.assertTrue(any("start" in line for line in lines)); self.assertTrue(any("complete" in line for line in lines))

if __name__ == "__main__": unittest.main()
