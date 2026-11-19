# GLBからの投影表示の復元

GLBは利用側へ渡す単一の成果物とする。編集JSONは復元に不要。一般的なGLBビューアーは標準マテリアルと頂点UVで近似表示し、専用表示側はGLB内のカメラ・画像・extrasを使って投影表示を復元する。再利用するTSL適用処理は`src/glb-projection.ts`、デモUIは`src/viewer.ts`、表示ページは`viewer.html`。

## 別プロジェクトでの最小限の使用例

Three.jsをインストールしたViteプロジェクトを想定する。`src/glb-projection.ts`を下のコードと同じ場所へコピーし、エディターで書き出したGLBを`public/scene.glb`に置く。他のエディター側ファイルは不要。Three.js 0.187系で検証している。

```ts
import { Scene, PerspectiveCamera, WebGPURenderer, NoToneMapping } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyCameraProjection } from './glb-projection'

const gltf = await new GLTFLoader().loadAsync('/scene.glb')
const projection = applyCameraProjection(gltf.scene) // TSLを即適用
const scene = new Scene()
scene.add(gltf.scene)
projection.updateProjection()

// 操作するのは表示用カメラだけ。projection.cameraは固定。
const camera = new PerspectiveCamera().copy(projection.camera, false)
projection.camera.matrixWorld.decompose(
  camera.position, camera.quaternion, camera.scale,
)

const renderer = new WebGPURenderer({ antialias: true })
renderer.toneMapping = NoToneMapping
await renderer.init()
const { width, height } = projection.composition
renderer.setSize(960, 960 * height / width)
document.body.append(renderer.domElement)

renderer.setAnimationLoop(() => {
  projection.updateProjection()
  renderer.render(scene, camera)
})
```

利用終了時：

```ts
renderer.setAnimationLoop(null)
projection.dispose()
await renderer.dispose()
```

`projection.dispose()`は元のマテリアルへ戻し、生成したTSLマテリアルだけを解放する。GLTFLoaderで読み込んだシーン・画像・元マテリアル・ジオメトリは呼び出し側が管理・解放する。複数回disposeしてもよいが、解放後はupdateProjectionを呼ばない。

## 独立ビューアー

`npm run dev`で起動し、`/viewer.html`を開く。エディターで書き出したGLBを「GLBを開く」から選択する。`npm run build`では`dist/viewer.html`も出力する。

- 表示はTSLのみ。独自ソートと明示的な事前コンパイルは行わず、Three.jsに任せる。
- 「基準カメラ」ではGLB内の投影カメラの姿勢を表示用カメラへコピーし、共通キャンバスのアスペクト比を維持する。「配置確認」では表示用カメラだけをOrbitControlsで操作する。投影カメラは固定する。
- extrasの検証に失敗した場合は既存の表示を残す。GLBは400MiB以下とし、外部ファイル参照には対応しない。

`src/viewer.ts`はGLTFLoaderによる読み込み、レンダラー、ファイル選択、カメラ操作と元リソースの解放を担当する。`src/glb-projection.ts`は読み込み済みシーンへTSLを適用する処理だけを持ち、DOM・Vite・Loader・エディター側のコードには依存しない。

## extras v1の仕様

型は`src/glb-projection-extras.ts`に定義する。glTFの`extras.threeLayeredScene`に格納し、Three.jsのGLTFLoaderでは各オブジェクトの`userData.threeLayeredScene`から取得できる。TSLのコードやノード構造、GPU固有の設定は保存しない。

### シーン

```json
{
  "version": 1,
  "role": "scene",
  "projectionCameraId": "projection-camera",
  "composition": { "width": 1920, "height": 1080 },
  "rendering": { "toneMapping": "none" },
  "projection": {
    "imageFit": "cover",
    "imageAlign": "center",
    "clipDepthRange": "minus-one-to-one",
    "projectedUvOrigin": "bottom-left",
    "textureUvOrigin": "top-left",
    "outsideImage": "clamp",
    "invalidProjection": "discard"
  }
}
```

`composition`は共通キャンバス寸法で、表示領域のアスペクト比や基準枠に使用する。FOV・aspect・near/farとカメラ変換は標準のglTFカメラに含まれるため重複保存しない。基準の表示ではトーンマッピングを適用しない。画像の色空間は標準のbaseColorTextureのsRGB指定に従う。

### 投影カメラのノード

```json
{ "version": 1, "role": "projectionCamera", "id": "projection-camera" }
```

同じGLBのシーン内を走査し、シーンの`projectionCameraId`と一致する`id`のPerspectiveCameraを見つける。ノード名やglTF配列のインデックスには依存しない。複数のGLBを読み込む場合は各シーン内で解決する。

表示・演出用には別のカメラを使い、投影カメラを動かさない。投影行列はWebGLのNDC深度範囲[-1, 1]で構築し、WebGPU描画用カメラの深度範囲と混同しない。Three.jsでは`WebGLCoordinateSystem`の投影カメラ（またはそのコピー）で行列を求める。GLB全体を移動・回転・拡縮した場合は、カメラを含むワールド行列を更新してから投影行列を作る。

### Planeのメッシュノード

共通項目は`version: 1`、`role: "layer"`、安定した`layerId`、元の一覧順を表す`listIndex`。読み込み側ではこの値による独自ソートを行わず、描画順はThree.jsに任せる。非表示レイヤーは出力しないため番号が飛ぶ場合がある。編集用の親Groupではなく、実際のメッシュノードに付与する。画像とOPAQUE／BLEND・片面表示などは標準マテリアルを参照し、重複保存しない。画像はGLTFLoaderで取得した`mesh.material.map`をTSLマテリアルのmapへ渡す。mapの`flipY`はglTFの読み込み時のfalseを維持する。

平行な面：

```json
{
  "version": 1,
  "role": "layer",
  "layerId": "layer-1",
  "listIndex": 0,
  "sampling": { "mode": "uv", "texCoord": 0 }
}
```

`TEXCOORD_0`（Three.jsの`uv`属性）は元画像の左上基準のUV。すでにcoverとV反転を適用しているため、そのUVを使ってmapを参照する。再投影・coverの再適用・Vの再反転はしない。標準のunlitマテリアルを使い続けることもできる。

垂直な面：

```json
{
  "version": 1,
  "role": "layer",
  "layerId": "ground",
  "listIndex": 2,
  "sampling": {
    "mode": "camera",
    "cameraId": "projection-camera",
    "imageUvScale": [1, 1],
    "imageUvOffset": [0, 0]
  }
}
```

`cameraId`で固定の投影カメラを解決し、次の処理をフラグメントごとに行う。imageUvScale／Offsetは出力時の画像寸法と共通キャンバスから求めた中央coverの変換。利用側で画像寸法から計算し直す必要はない。

```text
projectionFromWorld = projectionMatrix × matrixWorldInverse
clip = projectionFromWorld × vec4(positionWorld, 1)
clip.w <= 0 なら描画を破棄
ndc = clip.xyz / clip.w
ndc.z が [-1, 1] の外なら描画を破棄

projectedUV = ndc.xy × 0.5 + 0.5     // 左下基準
imageUV = projectedUV × imageUvScale + imageUvOffset
imageUV.y = 1 - imageUV.y           // 元画像の左上基準へ変換
color = map(clamp(imageUV, 0, 1))
```

平行な面と異なり、GLBの頂点UVは専用の投影表示では使わない。これは一般ビューアーの8×8 Gridによる近似プレビュー用であり、すでにcover・V反転済みのUVから再投影しない。

利用側はバージョン・role・sampling.mode・カメラ参照を確認してから適用する。未知のメタデータを対応済みとして扱わない。extrasを使用しなくても標準マテリアルでプレビュー可能であり、独自の必須glTF拡張は追加しない。
