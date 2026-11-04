"""
Measure a game recording's audio. The numbers in src/audio/audio.ts come from here.

    ffmpeg -i recording.MOV -vn -ac 1 -ar 48000 audio.wav
    python3 scripts/measure-audio.py audio.wav [--transients t1,t2,...] [--music a-b,c-d]

Needs numpy and scipy; nothing here ships. Prints:
  - level per half second, overall and per band;
  - the 120-300 Hz pulse train in a window: rate, intervals, per-pulse
    dominant frequency and bandwidth (footsteps);
  - per transient time: peak, attack, decay to -10/-20/-30 dB in the
    300-6000 Hz band, pitch glide every 5 ms (shot, hit);
  - per music window: melody and bass as note runs from a harmonic-product
    pitch tracker, bass period by autocorrelation.
It cannot tell a footstep from a bass note alone; use the video for that.
"""
import argparse
import numpy as np
from scipy import signal
from scipy.io import wavfile

NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]


def db(v):
    return 20 * np.log10(np.maximum(v, 1e-9))


def note(f):
    k = int(round(12 * np.log2(f / 440)))
    return f"{NAMES[k % 12]}{4 + ((k + 9) // 12)}"


def band(x, sr, lo, hi):
    sos = signal.butter(4, [lo, hi], "band", fs=sr, output="sos")
    return signal.sosfiltfilt(sos, x)


def envelope(x, sr, ms):
    h = int(ms / 1000 * sr)
    return np.sqrt(np.convolve(x**2, np.ones(h) / h, "same"))


def levels(x, sr):
    bands = {"120-300": (120, 300), "300-1k": (300, 1000), "1k-4k": (1000, 4000), "4k-12k": (4000, 12000)}
    bx = {k: band(x, sr, *v) for k, v in bands.items()}
    step = sr // 2
    print("t     all   " + "  ".join(f"{k:>8}" for k in bands))
    for i in range(0, len(x) - step, step):
        seg = slice(i, i + step)
        row = [db(np.sqrt(np.mean(x[seg] ** 2)))] + [db(np.sqrt(np.mean(bx[k][seg] ** 2))) for k in bands]
        print(f"{i / sr:5.1f} {row[0]:6.1f}  " + "  ".join(f"{v:8.1f}" for v in row[1:]))


def pulses(x, sr, a, b):
    seg = band(x, sr, 100, 400)[int(a * sr):int(b * sr)]
    e = envelope(seg, sr, 5)[:: int(0.005 * sr)]
    d = np.maximum(np.diff(e), 0)
    d /= d.max()
    pk, _ = signal.find_peaks(d, height=0.12, distance=30)
    t = a + pk * 0.005
    ioi = np.diff(t)
    print(f"\n100-400 Hz pulses {a}-{b}s: {len(t) / (b - a):.2f}/s, median interval {np.median(ioi):.3f}s, "
          f"share in 0.26-0.34 s: {np.mean((ioi > 0.26) & (ioi < 0.34)):.2f}")
    rows = []
    for t0 in t:
        i = int(t0 * sr)
        s = x[i:i + int(0.04 * sr)] * np.hanning(int(0.04 * sr))
        F = np.abs(np.fft.rfft(s, 1 << 16))
        f = np.fft.rfftfreq(1 << 16, 1 / sr)
        m = (f > 80) & (f < 400)
        j = np.argmax(F[m])
        half = np.where(F[m] > F[m][j] / np.sqrt(2))[0]
        rows.append((f[m][j], f[m][half[-1]] - f[m][half[0]]))
    r = np.array(rows)
    print(f"  dominant Hz: median {np.median(r[:, 0]):.0f}, range {r[:, 0].min():.0f}-{r[:, 0].max():.0f}; "
          f"-3 dB bandwidth median {np.median(r[:, 1]):.0f} Hz")
    full = envelope(x, sr, 2)
    pks = [db(full[int(t0 * sr):int(t0 * sr) + int(0.1 * sr)].max()) for t0 in t]
    print(f"  full-band 2 ms peak: median {np.median(pks):.1f} dBFS")


def transient(x, sr, t0):
    mid = envelope(band(x, sr, 300, 6000), sr, 2)
    i = int(t0 * sr) - int(0.01 * sr)
    e = mid[i:i + int(0.6 * sr)]
    j = np.argmax(e[: int(0.08 * sr)])
    p = e[j]

    def t_to(d):
        k = np.where(e[j:] < p * 10 ** (d / 20))[0]
        return k[0] / sr * 1000 if len(k) else 600

    glide = []
    for k in range(12):
        s = x[i + int(k * 0.005 * sr):i + int(k * 0.005 * sr) + int(0.02 * sr)] * np.hanning(int(0.02 * sr))
        F = np.abs(np.fft.rfft(s, 1 << 15))
        f = np.fft.rfftfreq(1 << 15, 1 / sr)
        m = (f > 150) & (f < 12000)
        glide.append(f[m][np.argmax(F[m])])
    print(f"  t={t0:.2f} peak {db(p):6.1f} dBFS attack {j / sr * 1000:4.0f} ms  -10:{t_to(-10):4.0f} -20:{t_to(-20):4.0f} "
          f"-30:{t_to(-30):4.0f} ms  glide/5ms " + " ".join(f"{g:.0f}" for g in glide))


def track(x, sr, a, b, lo, hi, hps):
    out = []
    for t0 in np.arange(a, b, 0.04):
        i = int(round(t0 * sr))
        n = int(0.06 * sr)
        s = x[i:i + n] * np.hanning(n)
        F = np.abs(np.fft.rfft(s, 1 << 16))
        f = np.fft.rfftfreq(1 << 16, 1 / sr)
        idx = np.where((f >= lo) & (f <= hi))[0]
        h = np.log(F[idx] + 1e-9).copy()
        for k in range(2, hps + 1):
            h += np.log(np.interp(f[idx] * k, f, F) + 1e-9)
        j = idx[np.argmax(h)]
        out.append((f[j], db(F[j] / n * 2)))
    lvl = np.median([l for _, l in out])
    runs = []
    for fr, l in out:
        nm = note(fr) if l > lvl - 12 else "."
        if runs and runs[-1][0] == nm:
            runs[-1][1] += 0.04
        else:
            runs.append([nm, 0.04])
    return " ".join(f"{nm}{d:.2f}" for nm, d in runs if d >= 0.08)


def music(x, sr, a, b):
    print(f"\nmusic {a}-{b}s")
    print("  melody:", track(x, sr, a, b, 350, 2000, 3))
    print("  bass:  ", track(x, sr, a, b, 55, 220, 2))
    lo = band(x, sr, 55, 220)[int(a * sr):int(b * sr)]
    e = envelope(lo, sr, 5)[:: int(0.005 * sr)]
    d = np.maximum(np.diff(e), 0)
    d -= d.mean()
    ac = np.correlate(d, d, "full")[len(d) - 1:]
    lags = np.arange(len(ac)) * 0.005
    m = (lags >= 0.45) & (lags < 0.8)
    print(f"  bass period: {lags[m][np.argmax(ac[m])]:.3f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--pulses", default="5-16.5", help="window for the footstep pulse train, a-b seconds")
    ap.add_argument("--transients", default="", help="comma-separated onset times")
    ap.add_argument("--music", default="", help="comma-separated a-b windows with no effects")
    args = ap.parse_args()
    sr, x = wavfile.read(args.wav)
    x = x.astype(np.float64) / 32768
    if x.ndim > 1:
        x = x.mean(1)
    levels(x, sr)
    a, b = (float(v) for v in args.pulses.split("-"))
    pulses(x, sr, a, b)
    if args.transients:
        print("\ntransients (300-6000 Hz):")
        for t in args.transients.split(","):
            transient(x, sr, float(t))
    for w in filter(None, args.music.split(",")):
        a, b = (float(v) for v in w.split("-"))
        music(x, sr, a, b)


if __name__ == "__main__":
    main()
