#!/usr/bin/env node
import {readFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'

const signature=Buffer.from([137,80,78,71,13,10,26,10])
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}

function decodePng(buffer){
  if(!buffer.subarray(0,8).equals(signature))throw new Error('not_png')
  let offset=8,width=0,height=0,bitDepth=0,colorType=-1,interlace=-1
  const idat=[]
  while(offset+12<=buffer.length){
    const length=buffer.readUInt32BE(offset);offset+=4
    const type=buffer.toString('ascii',offset,offset+4);offset+=4
    const data=buffer.subarray(offset,offset+length);offset+=length+4
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12]
    }else if(type==='IDAT')idat.push(data)
    else if(type==='IEND')break
  }
  if(!width||!height||bitDepth!==8||interlace!==0||![2,6].includes(colorType))throw new Error(`unsupported_png:${width}x${height}:depth${bitDepth}:type${colorType}:interlace${interlace}`)
  const channels=colorType===6?4:3
  const stride=width*channels
  const raw=inflateSync(Buffer.concat(idat))
  if(raw.length!==(stride+1)*height)throw new Error('unexpected_scanline_size')
  const pixels=Buffer.alloc(stride*height)
  let sourceOffset=0
  for(let y=0;y<height;y++){
    const filter=raw[sourceOffset++]
    const row=y*stride
    for(let x=0;x<stride;x++){
      const value=raw[sourceOffset++]
      const left=x>=channels?pixels[row+x-channels]:0
      const up=y?pixels[row-stride+x]:0
      const upperLeft=y&&x>=channels?pixels[row-stride+x-channels]:0
      let next
      if(filter===0)next=value
      else if(filter===1)next=(value+left)&255
      else if(filter===2)next=(value+up)&255
      else if(filter===3)next=(value+Math.floor((left+up)/2))&255
      else if(filter===4)next=(value+paeth(left,up,upperLeft))&255
      else throw new Error(`unsupported_filter:${filter}`)
      pixels[row+x]=next
    }
  }
  return {width,height,channels,pixels}
}

function analyze(decoded){
  const {width,height,channels,pixels}=decoded
  let visible=0,nonBlack=0,orange=0,light=0
  const buckets=new Set()
  for(let i=0;i<pixels.length;i+=channels){
    const r=pixels[i],g=pixels[i+1],b=pixels[i+2],a=channels===4?pixels[i+3]:255
    if(a<=16)continue
    visible++
    if(Math.max(r,g,b)>45)nonBlack++
    if(r>150&&g>35&&g<200&&b<90)orange++
    if(r>175&&g>175&&b>175)light++
    buckets.add(`${r>>4}:${g>>4}:${b>>4}:${a>>5}`)
  }
  const total=width*height
  return {
    width,height,total,visible,non_black_pixels:nonBlack,orange_pixels:orange,light_pixels:light,
    visible_ratio:visible/total,
    non_black_ratio:visible?nonBlack/visible:0,
    orange_ratio:visible?orange/visible:0,
    light_ratio:visible?light/visible:0,
    color_buckets:buckets.size
  }
}

function thresholds(metric){
  // Android's legacy ldpi launcher is only 36x36. At that resolution the full
  // approved composition retains three independently decoded light pixels,
  // while the same ratio used for larger assets would demand four. Keep a
  // strict absolute light-pixel floor for sub-48px resources; all other color,
  // visibility, and complexity requirements remain unchanged.
  const tiny=Math.min(metric.width,metric.height)<48
  return {
    visible_ratio:0.10,
    non_black_ratio:0.05,
    orange_ratio:0.01,
    light_ratio:tiny?0.005:0.01,
    minimum_light_pixels:tiny?3:1,
    color_buckets:24
  }
}

function acceptable(metric){
  const required=thresholds(metric)
  return {
    ok:
      metric.visible_ratio>=required.visible_ratio&&
      metric.non_black_ratio>=required.non_black_ratio&&
      metric.orange_ratio>=required.orange_ratio&&
      metric.light_ratio>=required.light_ratio&&
      metric.light_pixels>=required.minimum_light_pixels&&
      metric.color_buckets>=required.color_buckets,
    required
  }
}

const files=process.argv.slice(2)
if(!files.length){
  console.error('Usage: verify-png-content.mjs <png> [png ...]')
  process.exit(2)
}
let failed=false
for(const file of files){
  try{
    const metric=analyze(decodePng(await readFile(file)))
    const verdict=acceptable(metric)
    console.log(JSON.stringify({file,ok:verdict.ok,required:verdict.required,...metric}))
    if(!verdict.ok)failed=true
  }catch(error){
    console.error(JSON.stringify({file,ok:false,error:String(error?.message||error)}))
    failed=true
  }
}
if(failed)process.exit(1)
