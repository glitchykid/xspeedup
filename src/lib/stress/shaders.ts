// Original deferred workload: instanced geometry, PCF shadows, SSAO, GGX lighting and HDR bloom.
export const fullscreen = `#version 300 es
out vec2 uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
export const geometry = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
uniform float time; uniform mat4 transform; uniform int mode; uniform vec2 grid;
out vec3 world; flat out int material;
void main(){
 float id=float(gl_InstanceID); vec3 p=position; material=gl_InstanceID%4;
 if(mode==0){
   float a=time*.27+id*.7; mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a)); p.xz=r*p.xz; p.xy=r*p.xy;
   p*=.49; p+=vec3(mod(id,grid.x)-(grid.x-1.)*.5,floor(mod(id,grid.x*grid.y)/grid.x)-(grid.y-1.)*.5,-floor(id/(grid.x*grid.y))*2.2);
 }else{
   material=4;
   if(id<1.) p=p*vec3(12.,.15,18.)+vec3(0.,-3.3,-3.);
   else if(id<2.) p=p*vec3(12.,8.,.2)+vec3(0.,0.,-8.);
   else if(id<3.) p=p*vec3(12.,.15,18.)+vec3(0.,4.,-3.);
   else if(id<5.) p=p*vec3(.2,8.,18.)+vec3(id<4.?-6.:6.,0.,-3.);
   else { float k=id-5.; p=p*vec3(.18,7.,.25)+vec3(mod(k,2.)<1.?-4.8:4.8,.1,3.-floor(k/2.)*1.2); material=int(id)%4; }
 }
 world=p; gl_Position=transform*vec4(p,1.);
}`;
export const gbuffer = `#version 300 es
precision highp float;
in vec3 world; flat in int material; uniform float time;
layout(location=0) out vec4 location; layout(location=1) out vec4 normal; layout(location=2) out vec4 albedo;
void main(){
 vec3 n=normalize(cross(dFdx(world),dFdy(world))); if(!gl_FrontFacing)n=-n;
 vec3 palette[5]=vec3[5](vec3(.16,.20,.22),vec3(.65,.68,.61),vec3(.25,.48,.30),vec3(.65,.47,.20),vec3(.13,.16,.18));
 float detail=0.; vec3 q=world;
 for(int i=0;i<12;i++){q=sin(q.yzx*1.41+float(i)+time*.04);detail+=dot(q,q)*.02;}
 float seams=material==4?step(.95,fract(world.x*2.))*step(.5,abs(n.y))*.6:0.;
 location=vec4(world,1.);normal=vec4(n,material==0?.18:.42);albedo=vec4(palette[material]*(.65+detail*.3),seams);
}`;
export const depth = `#version 300 es
precision highp float;
void main() {}`;
export const ao = `#version 300 es
precision highp float; in vec2 uv; out vec4 color;
uniform sampler2D positions; uniform sampler2D normals; uniform mat4 viewProjection; uniform vec3 camera; uniform bool enabled;
void main(){
 vec4 pos=texture(positions,uv); if(!enabled||pos.a<.5){color=vec4(1.);return;}
 vec3 n=normalize(texture(normals,uv).xyz); float a=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)*6.283185;
 vec3 tangent=normalize(cross(n,abs(n.y)<.95?vec3(0.,1.,0.):vec3(1.,0.,0.))), bitangent=cross(n,tangent);
 float occlusion=0.;
 for(int i=0;i<16;i++){
   float k=(float(i)+.5)/16., phi=a+float(i)*2.399963;
   vec3 direction=tangent*cos(phi)*sqrt(k)+bitangent*sin(phi)*sqrt(k)+n*sqrt(1.-k);
   vec3 point=pos.xyz+direction*(.12+.62*k); vec4 projected=viewProjection*vec4(point,1.);
   vec2 coord=projected.xy/projected.w*.5+.5;
   if(any(lessThan(coord,vec2(0.)))||any(greaterThan(coord,vec2(1.))))continue;
   vec4 observed=texture(positions,coord);
   float inFront=step(length(camera-observed.xyz)+.025,length(camera-point));
   float range=1.-smoothstep(.5,1.5,length(observed.xyz-pos.xyz));
   occlusion+=inFront*range*observed.a;
 }
 color=vec4(vec3(pow(1.-occlusion/16.,1.8)),1.);
}`;
export const lighting = `#version 300 es
precision highp float; in vec2 uv; out vec4 color;
uniform sampler2D positions; uniform sampler2D normals; uniform sampler2D albedos; uniform sampler2D ambient; uniform sampler2D shadow;
uniform mat4 lightTransform; uniform vec3 camera; uniform vec3 keyLight; uniform float time; uniform bool shadows;
const float PI=3.14159265;
vec3 brdf(vec3 base,vec3 n,vec3 v,vec3 l,vec3 radiance,float rough){
 vec3 h=normalize(v+l); float nl=max(dot(n,l),0.),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.);
 float a=rough*rough,a2=a*a,d=nh*nh*(a2-1.)+1.,D=a2/(PI*d*d+.0001),k=(rough+1.)*(rough+1.)/8.;
 float G=(nl/(nl*(1.-k)+k+.0001))*(nv/(nv*(1.-k)+k));
 vec3 F=mix(vec3(.04),base,.65)+(1.-mix(vec3(.04),base,.65))*pow(1.-max(dot(h,v),0.),5.);
 return ((1.-F)*base*.35/PI+F*D*G/(4.*nl*nv+.001))*radiance*nl;
}
void main(){
 vec4 p=texture(positions,uv); if(p.a<.5){color=vec4(.014,.019,.022,1.);return;}
 vec4 nr=texture(normals,uv), ar=texture(albedos,uv);vec3 n=normalize(nr.xyz),v=normalize(camera-p.xyz);
 vec2 texel=1./vec2(textureSize(positions,0)); float occ=0.,weight=0.;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){vec2 coord=uv+vec2(x,y)*texel*2.;float w=exp(-length(texture(positions,coord).xyz-p.xyz)*8.);occ+=texture(ambient,coord).r*w;weight+=w;}
 vec3 lit=ar.rgb*.16*(occ/max(weight,.001))+ar.rgb*ar.a*3.;
 for(int i=0;i<16;i++){
   float f=float(i),a=time*(.25+f*.013)+f*2.399;
   vec3 light=vec3(sin(a)*(3.+mod(f,2.)),sin(a*.7+f)*2.5,cos(a)*3.-1.);
   vec3 delta=light-p.xyz;float dist=length(delta);vec3 hue=i%3==0?vec3(1.,.62,.27):i%3==1?vec3(.48,1.,.64):vec3(1.,.94,.78);
   lit+=brdf(ar.rgb,n,v,normalize(delta),hue*5./(1.+dist*dist),nr.w);
 }
 vec3 delta=keyLight-p.xyz;float visibility=1.;
 if(shadows){vec4 q=lightTransform*vec4(p.xyz,1.);vec3 s=q.xyz/q.w*.5+.5;
   if(all(greaterThan(s,vec3(0.)))&&all(lessThan(s,vec3(1.)))){
     visibility=0.;float bias=max(.0015*(1.-dot(n,normalize(delta))),.0005);vec2 stepSize=1./vec2(textureSize(shadow,0));
     for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)visibility+=s.z-bias<=texture(shadow,s.xy+vec2(x,y)*stepSize).r?1.:0.;visibility/=9.;
   }
 }
 lit+=brdf(ar.rgb,n,v,normalize(delta),vec3(5.,4.7,4.)*visibility,nr.w);
 color=vec4(lit,1.);
}`;
export const bloom = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D source;
void main(){vec2 pixel=1./vec2(textureSize(source,0));vec3 sum=vec3(0.);
 for(int x=-4;x<=4;x++){float w=exp(-float(x*x)/8.);vec3 c=texture(source,uv+vec2(float(x)*pixel.x*2.,0.)).rgb;sum+=max(c-vec3(.8),0.)*w;}
 color=vec4(sum/4.898,1.);}`;
export const composite = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D source; uniform sampler2D glow; uniform bool enabled;
void main(){vec3 hdr=texture(source,uv).rgb;
 if(enabled){vec2 pixel=1./vec2(textureSize(glow,0));vec3 b=vec3(0.);for(int y=-4;y<=4;y++)b+=texture(glow,uv+vec2(0.,float(y)*pixel.y)).rgb*exp(-float(y*y)/8.);hdr+=b*.14;}
 vec3 mapped=clamp((hdr*(2.51*hdr+.03))/(hdr*(2.43*hdr+.59)+.14),0.,1.);
 float vignette=1.-.16*dot(uv-.5,uv-.5);color=vec4(pow(mapped,vec3(1./2.2))*vignette,1.);
}`;
export const probe = `#version 300 es
precision highp float; precision highp int; layout(location=0) out uvec4 color; uniform uint seed;
uint hash(uint x){ x=(x^(x>>16u))*0x7feb352du; x=(x^(x>>15u))*0x846ca68bu; return x^(x>>16u); }
void main(){uint i=uint(gl_FragCoord.y)*16u+uint(gl_FragCoord.x),h=hash(i^seed);color=uvec4(h&255u,(h>>8u)&255u,(h>>16u)&255u,(h>>24u)&255u);}`;
export const antialias = `#version 300 es
precision highp float; in vec2 uv; out vec4 color; uniform sampler2D source;
void main(){
 vec2 px=1./vec2(textureSize(source,0)); vec3 nw=texture(source,uv+vec2(-1.,-1.)*px).rgb,ne=texture(source,uv+vec2(1.,-1.)*px).rgb;
 vec3 sw=texture(source,uv+vec2(-1.,1.)*px).rgb,se=texture(source,uv+px).rgb,center=texture(source,uv).rgb;
 vec3 luma=vec3(.299,.587,.114);float a=dot(nw,luma),b=dot(ne,luma),c=dot(sw,luma),d=dot(se,luma),m=dot(center,luma);
 float low=min(m,min(min(a,b),min(c,d))),high=max(m,max(max(a,b),max(c,d)));
 if(high-low<max(.0312,high*.125)){color=vec4(center,1.);return;}
 vec2 direction=vec2(-((a+b)-(c+d)),(a+c)-(b+d));float reduce=max((a+b+c+d)*.03125,.0078125);
 direction=clamp(direction/(min(abs(direction.x),abs(direction.y))+reduce),vec2(-8.),vec2(8.))*px;
 vec3 first=.5*(texture(source,uv+direction*(1./3.-.5)).rgb+texture(source,uv+direction*(2./3.-.5)).rgb);
 vec3 second=first*.5+.25*(texture(source,uv-direction*.5).rgb+texture(source,uv+direction*.5).rgb);
 float l=dot(second,luma);color=vec4(l<low||l>high?first:second,1.);
}`;
