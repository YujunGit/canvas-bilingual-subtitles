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
