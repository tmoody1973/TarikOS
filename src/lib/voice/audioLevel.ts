/* Volume for the orb. ElevenLabs' SDK handed us getInputVolume and
 * getOutputVolume; GPT-Live hands us media tracks. An AnalyserNode on each
 * track gives the same 0..1 number the orb already knows how to breathe to.
 * Returned as a getter, not state: the orb polls every frame. */

export type LevelMeter = { level: () => number; close: () => void };

export function meterFor(stream: MediaStream): LevelMeter {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  return {
    level() {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3);
    },
    close() {
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}

// Same curve VoiceDock and /talk apply to the ElevenLabs numbers.
export function scale(level: number): number {
  return Math.min(1, Math.pow(level, 0.5) * 2.5);
}
