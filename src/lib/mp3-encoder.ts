// MP3 encoder utility using lamejs loaded from CDN
// This avoids the MPEGMode global variable issues with the npm package

declare global {
  interface Window {
    lamejs: any
  }
}

let lamejsLoaded = false
let loadingPromise: Promise<boolean> | null = null

export async function initMp3Encoder(): Promise<boolean> {
  if (lamejsLoaded && window.lamejs) return true
  if (loadingPromise) return loadingPromise
  
  loadingPromise = new Promise((resolve) => {
    // Check if already loaded
    if (window.lamejs) {
      lamejsLoaded = true
      resolve(true)
      return
    }
    
    // Load from CDN
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js'
    script.async = true
    
    script.onload = () => {
      lamejsLoaded = true
      resolve(true)
    }
    
    script.onerror = () => {
      console.error('Failed to load lamejs from CDN')
      resolve(false)
    }
    
    document.head.appendChild(script)
  })
  
  return loadingPromise
}

export function getLamejs(): any {
  return window.lamejs
}

export function encodeBufferToMp3(buffer: AudioBuffer): Blob {
  const lamejs = window.lamejs
  if (!lamejs) {
    throw new Error('MP3 encoder not initialized. Please wait and try again.')
  }
  
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const kbps = 128

  // Get channel data
  const left = buffer.getChannelData(0)
  const right = numChannels > 1 ? buffer.getChannelData(1) : left

  // Convert to Int16
  const leftInt = new Int16Array(left.length)
  const rightInt = new Int16Array(right.length)
  
  for (let i = 0; i < left.length; i++) {
    leftInt[i] = Math.max(-32768, Math.min(32767, Math.floor(left[i] * 32767)))
    rightInt[i] = Math.max(-32768, Math.min(32767, Math.floor(right[i] * 32767)))
  }

  // Create MP3 encoder
  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps)
  const mp3Data: Int8Array[] = []

  // Encode in chunks of 1152 samples
  const blockSize = 1152
  for (let i = 0; i < leftInt.length; i += blockSize) {
    const leftChunk = leftInt.subarray(i, i + blockSize)
    const rightChunk = rightInt.subarray(i, i + blockSize)
    
    let mp3buf: Int8Array
    if (numChannels > 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk)
    }
    
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }
  }

  // Flush remaining
  const remaining = mp3encoder.flush()
  if (remaining.length > 0) {
    mp3Data.push(remaining)
  }

  // Combine all MP3 data
  const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
  const mp3Combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of mp3Data) {
    mp3Combined.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), offset)
    offset += chunk.length
  }

  return new Blob([mp3Combined], { type: 'audio/mp3' })
}
