// MP3 encoder utility using lamejs
// lamejs needs MPEGMode to be global, so we handle that here

let lamejsLoaded = false
let lamejs: any = null

export async function initMp3Encoder(): Promise<boolean> {
  if (lamejsLoaded && lamejs) return true
  
  try {
    const module = await import('lamejs')
    lamejs = module.default || module
    
    // Set MPEGMode globally - lamejs needs this internally
    if (typeof window !== 'undefined' && lamejs.MPEGMode) {
      // @ts-ignore
      window.MPEGMode = lamejs.MPEGMode
    }
    
    lamejsLoaded = true
    return true
  } catch (err) {
    console.error('Failed to load lamejs:', err)
    return false
  }
}

export function getLamejs(): any {
  return lamejs
}

export function encodeBufferToMp3(buffer: AudioBuffer): Blob {
  if (!lamejs) {
    throw new Error('MP3 encoder not initialized. Call initMp3Encoder() first.')
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
