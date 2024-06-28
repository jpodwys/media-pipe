/**
 * This file accepts an input MediaStream and exposes a new MediaStream
 * with a blurred background using the following steps
 * 1. Render the input MediaStream to a <video> tag
 * 2. For each frame rendered to the <video> tag, pass the <video> tag to selfieSegmentation.send
 * 3. When selfieSegmentation completes its segmentation for the given frame, it calls render and
 * passes the original video frame and that frame's segmentation map
 * 4. The render method uses a canvas to apply the segmentation map to the video frame so that the
 * background is blurred and the pixels represented by the segmentation map are not blurred.
 * 5. Using canvas.captureStream, we expose a video feed of the canvas to be consumed via getOutputStream
 *
 * Toggling blur is pretty cool too. The outputStream acts as a proxy for whichever MediaStreamTrack
 * should render. When blur is enabled, outputStream contains the MediaStreamTrack from canvasCapture.
 * When blur is disabled, outputStream indstead contains the MediaStreamTrack from the input MediaStream.
 * This means that when blur is disabled, this file completely stops segmenting and drawing to the canvas.
 * It also means that users of this file can consume a single MediaStream they can publish.
 */
function Blur (mediaStream, width, height, frameRate, canvasElement) {
  let shouldBlur = true;
  let blurAmount = 10;
  let intervalId;
  // const canvasElement = document.createElement('canvas');
  canvasElement.width = width;
  canvasElement.height = height;
  const canvasCtx = canvasElement.getContext('2d');
  const selfieSegmentation = new SelfieSegmentation({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
  }});
  selfieSegmentation.setOptions({
    modelSelection: 1,
  });
  selfieSegmentation.onResults(render);
  const [ inputTrack ] = mediaStream.getVideoTracks();
  // const outputStream = canvasElement.captureStream(frameRate);
  // const [ outputTrack ] = outputStream.getVideoTracks()
  const videoElement = document.createElement('video');
  videoElement.setAttribute('autoplay', true);
  videoElement.setAttribute('style',
    `
      width: 1px;
      height: 1px;
      position: absolute;
      left: -1000;
    `
  );
  videoElement.addEventListener('play', blur);
  videoElement.srcObject = mediaStream;
  document.body.appendChild(videoElement);
  const supportsFrameCallback = !!videoElement.requestVideoFrameCallback;

  function getOutputStream () {
    // return outputStream;
  }

  function toggleBlur () {
    shouldBlur = !shouldBlur;
    if (shouldBlur) {
      // When blur is disabled, we stop drawing to the canvas. This means that
      // when blur is re-enabled, the canvas is out of sync with the video input.
      // Starting blur first then swapping tracks after a delay allows us to re-sync frames.
      blur();
      setTimeout(() => {
        outputStream.addTrack(outputTrack);
        outputStream.removeTrack(inputTrack);
      }, 1000 / (frameRate / 2));
    } else {
      outputStream.addTrack(inputTrack);
      outputStream.removeTrack(outputTrack);
    }
  }

  function setBlurAmount (amount) {
    blurAmount = amount;
  }

  async function blur () {
    if (!shouldBlur) {
      return;
    }
    selfieSegmentation.send({ image: videoElement });
    if (supportsFrameCallback) {
      videoElement.requestVideoFrameCallback(blur);
    } else if (!intervalId) {
      intervalId = setInterval(blur, 1000 / 24);
    }
  }

  function render (results) {
    // Save the context's blank state
    canvasCtx.save();

    // Draw the raw frame
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (shouldBlur) {
      // Make all pixels not in the segmentation mask transparent
      canvasCtx.globalCompositeOperation = 'destination-atop';
      canvasCtx.drawImage(results.segmentationMask, 0, 0, canvasElement.width, canvasElement.height);

      // Set the raw image as the background but squish it a little to hide the halo effect behind
      // the foreground layer. This creates a nearly-perfect edge while the subject is centered.
      // Because I shrunk the background image, I fill in the left, right, and top borders with
      // duplicate, overlapping pixels. Overlapping blends the edges nicely.
      canvasCtx.filter = `blur(${blurAmount}px)`;
      canvasCtx.globalCompositeOperation = 'destination-over';
      canvasCtx.drawImage(results.image, 0, 0, 30, canvasElement.height, 0, 0, 30, canvasElement.height);
      canvasCtx.drawImage(results.image, canvasElement.width - 30, 0, canvasElement.width, canvasElement.height, canvasElement.width - 30, 0, canvasElement.width, canvasElement.height);
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, 30, 0, 0, canvasElement.width, 30);

      // Draw the shrunken background
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height, 15, 10, canvasElement.width - 30, canvasElement.height - 10);
    }

    // Restore the context's blank state
    canvasCtx.restore();
  }

  return { getOutputStream, toggleBlur, setBlurAmount };
}
