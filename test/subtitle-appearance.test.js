import test from 'node:test';
import assert from 'node:assert/strict';
import {subtitleAlpha,subtitlePlacement} from '../src/player.js';
test('background transparency endpoints, default and invalid values',()=>{
  assert.equal(subtitleAlpha(0),1);
  assert.equal(subtitleAlpha(100),0);
  assert.equal(subtitleAlpha(22),.78);
  assert.equal(subtitleAlpha(undefined),.78);
  assert.equal(subtitleAlpha(-50),1);
  assert.equal(subtitleAlpha(150),0);
});
test('default placement preserves bottom margin and horizontal centering',()=>{
  assert.deepEqual(subtitlePlacement({left:100,top:50,width:1000,height:500},880,100,null),{left:160,top:390});
});
test('saved placement adapts to resized video and clamps at video edges',()=>{
  const rect={left:100,top:50,width:1000,height:500};
  assert.deepEqual(subtitlePlacement(rect,880,100,{x:1,y:1}),{left:220,top:450});
  assert.deepEqual(subtitlePlacement({left:0,top:0,width:500,height:250},440,100,{x:1,y:1}),{left:60,top:150});
  assert.deepEqual(subtitlePlacement(rect,880,100,{x:-5,y:8}),{left:100,top:450});
  assert.deepEqual(subtitlePlacement(rect,1000,500,{x:1,y:1}),{left:100,top:50});
});

import {subtitleWidth,resizeSubtitle} from '../src/player.js';
test('resize either edge keeps opposite edge fixed and enforces minimum width',()=>{
  const rect={left:100,width:1000},initial={left:160,right:1040};
  for(const [side,pointer,expectedLeft,expectedRight] of [
    ['left',400,400,1040],['right',700,160,700],
    ['left',-100,100,1040],['right',1500,160,1100],
    ['left',2000,840,1040],['right',0,160,360]
  ]){
    const result=resizeSubtitle(rect,initial,side,pointer);
    const width=result.widthRatio*rect.width;
    const left=rect.left+result.x*(rect.width-width);
    assert(Math.abs(left-expectedLeft)<1e-8);
    assert(Math.abs(left+width-expectedRight)<1e-8);
  }
});
test('saved width defaults and full-width resize stay finite',()=>{
  assert.equal(subtitleWidth(undefined),.88);
  assert.equal(subtitleWidth(NaN),.88);
  assert.equal(subtitleWidth(.01),.2);
  assert.equal(subtitleWidth(2),1);
  assert.deepEqual(resizeSubtitle({left:0,width:500},{left:0,right:400},'right',600),{widthRatio:1,x:.5});
});
