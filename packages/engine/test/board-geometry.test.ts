import { describe, expect, it } from 'vitest';
import { createBoard } from '../src/index.js';

const physical=(x:number,y:number)=>[x*Math.sqrt(3),y] as const;

describe('regular board geometry and stable graph ids',()=>{
  it('uses six distinct, equally spaced pointy-top corners for every tile',()=>{
    const {board}=createBoard(123);
    for(const tile of board.tiles){
      expect(new Set(tile.vertices).size).toBe(6);
      const points=tile.vertices.map(id=>physical(board.vertices[id]!.x,board.vertices[id]!.y));
      expect(new Set(points.map(([x,y])=>`${x.toFixed(6)},${y.toFixed(6)}`)).size).toBe(6);
      const lengths=points.map((point,index)=>{const next=points[(index+1)%points.length]!;return Math.hypot(next[0]-point[0],next[1]-point[1]);});
      for(const length of lengths)expect(length).toBeCloseTo(2,6);
    }
  });

  it('shares interior graph vertices and edges exactly once',()=>{
    const {board}=createBoard(321);
    expect(board.vertices.some(vertex=>vertex.tiles.length===3)).toBe(true);
    expect(board.vertices.every(vertex=>vertex.tiles.length>=1&&vertex.tiles.length<=3)).toBe(true);
    expect(board.edges.some(edge=>edge.tiles.length===2)).toBe(true);
    expect(board.edges.every(edge=>edge.tiles.length>=1&&edge.tiles.length<=2)).toBe(true);
    for(const tile of board.tiles){
      expect(new Set(tile.edges).size).toBe(6);
      for(const edgeId of tile.edges)expect(board.edges[edgeId]!.tiles).toContain(tile.id);
    }
    for(const edge of board.edges)for(const vertexId of edge.vertices)expect(board.vertices[vertexId]!.edges).toContain(edge.id);
  });

  it('keeps vertex, edge and tile topology ids stable across seeded layouts',()=>{
    const first=createBoard(1).board,second=createBoard(987654).board;
    expect(second.vertices.map(v=>({id:v.id,x:v.x,y:v.y,edges:v.edges,tiles:v.tiles}))).toEqual(first.vertices.map(v=>({id:v.id,x:v.x,y:v.y,edges:v.edges,tiles:v.tiles})));
    expect(second.edges).toEqual(first.edges);
    expect(second.tiles.map(tile=>({id:tile.id,vertices:tile.vertices,edges:tile.edges,q:tile.q,r:tile.r}))).toEqual(first.tiles.map(tile=>({id:tile.id,vertices:tile.vertices,edges:tile.edges,q:tile.q,r:tile.r})));
  });
});
