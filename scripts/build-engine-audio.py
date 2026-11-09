#!/usr/bin/env python3
"""Build seamless engine loops for FOCUS DRIVE from the CC BY 4.0 Ferrari 250 GTO recording.

Source (downloaded by scripts/fetch-engine-source.sh, NOT stored in the repo):
  https://upload.wikimedia.org/wikipedia/commons/8/8a/Ferrari_250_GTO%2C_Engine_Sound.ogg
  Wikimedia Commons, "Ferrari 250 GTO, Engine Sound", by Provo rossi, CC BY 4.0.

Usage: python3 scripts/build-engine-audio.py <source.ogg> <outdir>
Produces two RPM layers; the game crossfades and pitch-shifts them by engine speed.
"""
import subprocess, sys, os
import numpy as np

SR = 44100
# Steady-RPM windows picked from the recording (see docs/ENGINE_AUDIO.md). Adjacent layers
# stay within ~2x firing frequency so the runtime only ever shifts pitch by a modest amount.
LOOPS = [
    ("engine-1", 56.85, 1.10),
    ("engine-2", 24.00, 1.10),
    ("engine-3", 42.60, 1.10),
    ("engine-4", 42.15, 1.10),
]


def load_mono(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def fundamental_period(x, start, seconds=0.35, sr=SR):
    """Autocorrelation lag of the engine's firing period inside a steady window."""
    seg = x[int(start * sr):int((start + seconds) * sr)]
    seg = seg - seg.mean()
    corr = np.correlate(seg, seg, mode="full")[len(seg) - 1:]
    lo, hi = int(sr / 1200), int(sr / 60)
    lag = lo + int(np.argmax(corr[lo:hi]))
    return lag


def seamless(x, start_s, target_s=1.2, fade_s=0.05):
    """Loop an integer number of firing periods, blending the head into the post-loop tail.

    R[0] becomes the sample just after the loop end and R[-1] is the sample just before it,
    so the wrap point is continuous. Both the loop and the crossfade span whole periods,
    which keeps the waveform itself intact instead of smearing it.
    """
    period = fundamental_period(x, start_s)
    length = period * max(1, round(target_s * SR / period))
    fade = period * max(1, round(fade_s * SR / period))
    start = int(start_s * SR)
    source = x[start:start + length + fade]
    body = source[:length].copy()
    ramp = np.linspace(0.0, 1.0, fade)
    body[:fade] = source[length:length + fade] * (1 - ramp) + source[:fade] * ramp
    return body, period


def polish(x):
    # Remove sub-rumble, even out the level, then leave headroom.
    sos = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
                          "-af", "highpass=f=55,acompressor=threshold=-18dB:ratio=3:attack=5:release=120",
                          "-f", "f32le", "-ar", str(SR), "-ac", "1", "pipe:1"],
                         input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    y = np.frombuffer(sos, dtype=np.float32).copy()
    return y


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    # Filter and level the whole recording first: running a dynamic compressor or a
    # highpass after the loop is cut leaves the wrap point at a different filter state.
    x = polish(load_mono(src))
    layers = []
    for name, start_s, loop_s in LOOPS:
        loop, period = seamless(x, start_s, loop_s)
        loop = loop * (0.16 / (np.sqrt(np.mean(loop ** 2)) + 1e-9))
        peak = np.max(np.abs(loop)) + 1e-9
        if peak > 0.9:
            loop = loop * (0.9 / peak)
        wav = f"/tmp/{name}.wav"
        import wave
        with wave.open(wav, "wb") as fh:
            fh.setnchannels(1); fh.setsampwidth(2); fh.setframerate(SR)
            fh.writeframes((np.clip(loop, -1, 1) * 32767).astype("<i2").tobytes())
        # WAV keeps the loop sample-exact: MP3/AAC encoder delay would smear the junction.
        out = os.path.join(outdir, f"{name}.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "pcm_s16le", "-ar", str(SR), "-ac", "1", out], check=True)
        firing = SR / period
        base_rpm = round(firing * 10)  # V12 four-stroke: firing frequency = rpm / 10
        layers.append({"file": f"/audio/{name}.wav", "baseRpm": base_rpm})
        print(f"{out}  loop={len(loop)/SR:.3f}s periods={round(len(loop)/period)} firing={firing:.0f}Hz base_rpm={base_rpm} bytes={os.path.getsize(out)}")
    import json
    with open(os.path.join(outdir, "engine-layers.json"), "w") as fh:
        json.dump({"layers": layers, "note": "Recorded engine loops; see CREDITS.md for attribution."}, fh, indent=2)
    print(f"{outdir}/engine-layers.json  layers={len(layers)}")


if __name__ == "__main__":
    main()
