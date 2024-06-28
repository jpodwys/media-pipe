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

const hiddenStyles = `
  width: 1px;
  height: 1px;
  position: absolute;
  bottom: 5px;
  left: 5px;
  opacity: .1;
`;

function isMobile () {
  let check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
  return check;
}

function Blur (mediaStream, width, height, frameRate) {
  let shouldBlur = true;
  let blurAmount = 10;
  let intervalId;
  let lastMask;
  let frameCount = 1;
  let skipTimer;
  let segmentTimer;
  let startTime;
  let totalFrames = 0;
  let throttleSegmentation = isMobile();
  const fpsDisplay = document.getElementById('fps');
  const canvasElement = document.createElement('canvas');
  canvasElement.setAttribute('style', hiddenStyles);
  document.body.appendChild(canvasElement);
  canvasElement.width = width;
  canvasElement.height = height;
  const offscreenCanvas = new OffscreenCanvas(width, height);
  const offscreenCtx = offscreenCanvas.getContext('2d');
  const canvasCtx = canvasElement.getContext('2d');
  const selfieSegmentation = new SelfieSegmentation({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`;
  }});
  selfieSegmentation.setOptions({ modelSelection: 1 });
  selfieSegmentation.onResults(render);
  const [ inputTrack ] = mediaStream.getVideoTracks();
  const outputStream = canvasElement.captureStream(frameRate);
  const [ outputTrack ] = outputStream.getVideoTracks()
  const videoElement = document.createElement('video');
  videoElement.setAttribute('autoplay', true);
  videoElement.setAttribute('style', hiddenStyles);
  videoElement.addEventListener('play', blur);
  videoElement.srcObject = mediaStream;
  document.body.appendChild(videoElement);
  const supportsFrameCallback = !!videoElement.requestVideoFrameCallback;

  function getOutputStream () {
    return outputStream;
  }

  function toggleThrottle () {
    throttleSegmentation = !throttleSegmentation;
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
    if (frameCount === 2 && lastMask && throttleSegmentation) {
      frameCount = 0;
      skipTimer = Date.now();
      offscreenCtx.drawImage(videoElement, 0, 0);
      const image = await createImageBitmap(offscreenCanvas);
      render({ image, segmentationMask: lastMask, skip: true });
    } else {
      frameCount = 2;
      segmentTimer = Date.now();
      await selfieSegmentation.send({ image: videoElement });
    }
    if (supportsFrameCallback) {
      videoElement.requestVideoFrameCallback(blur);
    } else if (!intervalId) {
      intervalId = setInterval(blur, 1000 / 24);
    }
  }

  function render (results) {
    if (!startTime) {
      startTime = Date.now();
      setInterval(() => {
        if (totalFrames) {
          const now = Date.now();
          const elapsed = (now - startTime) / 1000;
          fpsDisplay.innerText = `FPS: ${totalFrames / elapsed}`;
        }
      }, 500);
      setInterval(() => {
        totalFrames = 1;
        startTime = Date.now();
      }, 4000);
    }
    totalFrames++;
    // const now = Date.now();
    // if (results.skip) {
    //   console.log('skip frame time', now - skipTimer);
    // } else {
    //   console.log('segment frame time', now - segmentTimer);
    // }
    lastMask = results.segmentationMask;
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

  return { getOutputStream, toggleBlur, setBlurAmount, toggleThrottle };
}
