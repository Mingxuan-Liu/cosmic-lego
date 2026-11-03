# Third-party notices

Cosmic Lego's original code remains under the repository's
[BSD 3-Clause License](../LICENSE). Dependencies retain their own licenses.

## Three.js 0.187.0

F05 uses **three 0.187.0 (r187)**, including OrbitControls from the same package.
The version is pinned in `package.json` and `pnpm-lock.yaml`. The notice below is
copied verbatim from the installed package's `LICENSE` file; retain it with copies
or substantial portions of Three.js in distributions.

The maintained library was selected after checking current primary documentation
and licensing on **2026-11-03**. The adapter keeps this choice replaceable; it is
not a permanent commitment for every Cosmic Lego renderer. The implementation
uses WebGL2, depth testing, instance matrices/colors, explicit resource disposal,
and perspective/orthographic OrbitControls.

Primary sources inspected for this implementation:

- [Three.js package/source and license](https://github.com/mrdoob/three.js)
- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Texture](https://threejs.org/docs/pages/Texture.html)
- [Object3D disposal](https://threejs.org/docs/pages/Object3D.html)

Installed r187 `InstancedMesh.js` and `Object3D.js` were also inspected to verify
object/instance disposal separately from shared geometries, materials, and textures.
Automated renderer resource and scene-compilation integration tests use this
installed version. Browser inspection is recorded separately in the
[F05 handoff](handoffs/F05.md).

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
