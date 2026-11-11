import { useEffect, useState } from "react";

let sharedContext = null;
export function getAudioContext() {
  if (!sharedContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    sharedContext = Ctx ? new Ctx() : null;
  }
  return sharedContext;
}

/** True while the audio track in `stream` is above a speaking threshold. */
export function useSpeaking(stream, enabled = true) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    const ctx = getAudioContext();
    if (!enabled || !track || !ctx) {
      setSpeaking(false);
      return;
    }
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    let last = false;
    let quietTicks = 0;

    const id = setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const loud = Math.sqrt(sum / buffer.length) > 0.035;
      quietTicks = loud ? 0 : quietTicks + 1;
      const now = loud || (last && quietTicks < 4); // short hold avoids flicker
      if (now !== last) {
        last = now;
        setSpeaking(now);
      }
    }, 120);

    return () => {
      clearInterval(id);
      source.disconnect();
    };
  }, [stream, enabled]);

  return speaking;
}
