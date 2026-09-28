"""Small, dependency-free phase and heartbeat reporter for long PBF work."""
import threading
import time

class ProgressReporter:
    def __init__(self, enabled=False, label="", interval=15, clock=time.monotonic, emit=print):
        self.enabled, self.label, self.interval, self.clock, self.emit = enabled, label, interval, clock, emit
    def line(self, message):
        if self.enabled: self.emit(message, flush=True)
    def phase(self, description):
        return _Phase(self, description)

class _Phase:
    def __init__(self, reporter, description):
        self.reporter, self.description, self.stop = reporter, description, threading.Event()
        self.thread = None; self.started = None
    def __enter__(self):
        self.started = self.reporter.clock(); self.reporter.line(f"[{self.reporter.label}] {self.description} start")
        if self.reporter.enabled:
            self.thread = threading.Thread(target=self._heartbeat, daemon=True); self.thread.start()
        return self
    def _heartbeat(self):
        while not self.stop.wait(self.reporter.interval):
            elapsed = int(self.reporter.clock() - self.started)
            self.reporter.line(f"[{elapsed//3600:02}:{(elapsed//60)%60:02}:{elapsed%60:02}] [{self.reporter.label}] Still working: {self.description.lower()}... elapsed {elapsed}s")
    def __exit__(self, exc_type, exc, traceback):
        self.stop.set()
        if self.thread: self.thread.join()
        elapsed = self.reporter.clock() - self.started
        self.reporter.line(f"[{self.reporter.label}] {self.description} {'failed' if exc_type else 'complete'} ({elapsed:.1f}s)")
