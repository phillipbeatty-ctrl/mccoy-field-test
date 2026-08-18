import { adminDb } from './_lib.mjs';

function authorized(req){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return token && token===process.env.MCCOY_DEV_INTERNAL_TOKEN;
}

export default async function handler(req,res){
  if(!authorized(req)) return res.status(401).json({error:'unauthorized'});
  try{
    const db=adminDb();
    if(req.method==='GET'){
      const status=req.query?.status||null;
      let q=db.from('mccoy_dev_queue').select('*').order('priority',{ascending:false}).order('created_at',{ascending:true}).limit(100);
      if(status) q=q.eq('status',status);
      const {data,error}=await q;if(error)throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }
    if(req.method==='POST'){
      const b=req.body||{};
      if(b.action==='enqueue'){
        const row={app_target:b.app_target||'field-coach',request_type:b.request_type||'build_change',title:b.title||'Remote development task',instructions:b.instructions||'',status:b.status||'draft',priority:Number(b.priority||50),requested_by:b.requested_by||'admin',requested_from:b.requested_from||'api',deployed_url:b.deployed_url||null,build_metadata:b.build_metadata||{}};
        const {data,error}=await db.from('mccoy_dev_queue').insert(row).select('*').single();if(error)throw error;
        return res.status(201).json({ok:true,item:data});
      }
      if(b.action==='update'&&b.id){
        const allowed=['status','title','instructions','priority','test_result','test_notes','deployed_url','source_commit','build_metadata','approved_by','approved_at'];
        const patch={};for(const k of allowed)if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=b[k];
        const {data,error}=await db.from('mccoy_dev_queue').update(patch).eq('id',b.id).select('*').single();if(error)throw error;
        return res.status(200).json({ok:true,item:data});
      }
      return res.status(400).json({error:'invalid_action'});
    }
    return res.status(405).json({error:'method_not_allowed'});
  }catch(e){
    console.error('dev-queue',e);
    return res.status(500).json({error:'dev_queue_failed',detail:String(e?.message||e)});
  }
}
