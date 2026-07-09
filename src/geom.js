// ---------- pure stock geometry (no DOM, node-testable) ----------
// Cylindrical-billet (round bar) top-surface heights for the 2.5D heightfield.
// The billet centerline runs through the world origin in the plane normal to its axis.
//
//   axis 'X': bar axis along X, circular cross-section in the Y-Z plane, centerline at
//             Y=0 with the top tangent to Z0 (centerline Z = -r).
//             z(y) = -r + sqrt(r² - y²); cells with |y| > r are empty (no material).
//   axis 'Z': bar axis along Z (vertical), circular footprint in X-Y centered on the
//             origin, radius r; flat top at ztop inside the footprint, empty outside.
//
// Returns the stored height, or `empty` (the heightfield floor) where there is no material.
function billetHeight(axis, r, x, y, ztop, empty){
  if(axis==='X'){
    if(Math.abs(y) > r) return empty;
    return -r + Math.sqrt(Math.max(r*r - y*y, 0));
  }
  // axis 'Z'
  if(x*x + y*y > r*r) return empty;
  return ztop;
}

// XY extent the billet occupies, to union with the toolpath bounds when sizing the grid.
//   axis 'X': extruded along X (grid X stays path-driven -> x:null); y in [-r, r];
//             lowest top-surface point is -r (the sides).
//   axis 'Z': circular footprint -> x and y in [-r, r]; top is the flat ztop.
function billetBounds(axis, r, ztop){
  if(axis==='X') return {x:null, y:[-r, r], minTop:-r};
  return {x:[-r, r], y:[-r, r], minTop:ztop};
}
if(typeof module!=='undefined'&&module.exports){ module.exports={billetHeight,billetBounds}; }
