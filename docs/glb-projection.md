# GLBからの投影表示の復元

GLBは利用側へ渡す単一の成果物とする。編集JSONは復元に不要。一般的なGLBビューアーは標準マテリアルと頂点UVで近似表示し、専用表示側はGLB内のカメラ・画像・extrasを使って投影表示を復元する。再利用する読み込み側の実装は`src/glb-viewer/`、デモUIは`src/viewer.ts`、表示ページは`viewer.html`。

型は`src/glb-projection-extras.ts`に定義する。glTFの`extras.threeLayeredScene`に格納し、Three.jsのGLTFLoaderでは各オブジェクトの`userData.threeLayeredScene`から取得できる。TSLのコードやノード構造、GPU固有の設定は保存しない。

## シーン

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

## 投影カメラのノード

```json
{ "version": 1, "role": "projectionCamera", "id": "projection-camera" }
```

同じGLBのシーン内を走査し、シーンの`projectionCameraId`と一致する`id`のPerspectiveCameraを見つける。ノード名やglTF配列のインデックスには依存しない。複数のGLBを読み込む場合は各シーン内で解決する。

表示・演出用には別のカメラを使い、投影カメラを動かさない。投影行列はWebGLのNDC深度範囲[-1, 1]で構築し、WebGPU描画用カメラの深度範囲と混同しない。Three.jsでは`WebGLCoordinateSystem`の投影カメラ（またはそのコピー）で行列を求める。GLB全体を移動・回転・拡縮した場合は、カメラを含むワールド行列を更新してから投影行列を作る。

## Planeのメッシュノード

共通項目は`version: 1`、`role: "layer"`、安定した`layerId`、元の一覧順を表す`listIndex`。同じ描画深度の場合の順序を揃える際はlistIndexの昇順を使う。非表示レイヤーは出力しないため番号が飛ぶ場合がある。編集用の親Groupではなく、実際のメッシュノードに付与する。画像とOPAQUE／BLEND・片面表示などは標準マテリアルを参照し、重複保存しない。画像はGLTFLoaderで取得した`mesh.material.map`をTSLマテリアルのmapへ渡す。mapの`flipY`はglTFの読み込み時のfalseを維持する。

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


## 独立ビューアー

`npm run dev`で起動し、`/viewer.html`を開く。エディターで保存したGLBを「GLBを開く」から選択する。`npm run build`でもエディターとビューアー両方のHTMLを出力する。

- 初期表示はTSL投影。描画方式を「標準表示」にすると元のGLBマテリアルと頂点UVによる近似と比較できる。
- 「基準カメラ」はGLB内の投影カメラの姿勢を表示用カメラへコピーする。共通キャンバスのアスペクト比を維持して表示する。
- 「配置確認」では別のカメラをOrbitControlsで操作する。ドラッグで回転、ホイールで拡大縮小、右ドラッグで移動。「カメラを戻す」で選択中の表示方法の初期位置へ戻る。投影用カメラは表示・操作に使わず固定する。
- 描画はWebGPURendererを使い、Three.js標準のWebGL 2フォールバックも利用する。元マテリアルのmap・色・不透明度・透過・片面／両面設定をTSL側へ引き継ぐ。
- 読み込み時にextrasのバージョン・座標規約・参照、レイヤーIDと一覧順の重複、カメラ設定、mapとUVを検証する。TSLと標準表示のシェーダーを準備してから現在の表示を置き換える。読み込み失敗時はエラーを表示し、既存の表示を残す。
- GLBは400MiB以下とし、外部ファイル参照には対応しない。新しいGLBへの差し替え時は旧マテリアル・テクスチャ・ジオメトリを解放する。

`src/glb-viewer/`の依存先はThree.jsとそのaddons、同ディレクトリ内のモジュールだけ。DOM・Vite・レンダラー・ファイル選択・OrbitControls・エディター側のコードや型には依存しない。`src/viewer.ts`はこのAPIを呼ぶデモUIで、レンダラー・表示用カメラ・操作・シェーダーの事前コンパイル・画面の差し替えを担当する。

自動テストでは実際のGLB出力をGLTFLoaderで読み戻し、独立した復元APIへ渡す。テスト中の画像デコードは置き換え、画像参照・座標・extras・表示モードの切り替え・不正データの拒否を確認する。GPUでの見た目とブラウザー操作の確認は未実施。


## 別プロジェクトでの再利用

`src/glb-viewer/`ディレクトリ全体をコピーし、Three.jsを用意する。エディター側のファイル、viewer.html、viewer.tsは不要。現在はThree.js 0.187系で検証している。NodeMaterialを描画するレンダラーはWebGPURenderer（WebGL 2フォールバックを含む）を使う。

| モジュール | 役割 |
| --- | --- |
| index.ts | 公開APIと型の入口 |
| load.ts | GLBバッファの読み込み、TSL適用、読み込んだリソース全体の管理 |
| asset.ts | 読み込み済みシーンのextras検証・投影の組み立て、表示モード・投影行列の更新、深度が同じ場合のソート |
| material.ts | TSL投影マテリアルの生成 |
| metadata.ts | 読み込み側で独立して持つextrasの型・検証 |

### GLBの読み込みとTSL適用

```ts
import * as THREE from 'three/webgpu'
import { parseProjectionGlb, projectionRenderSort } from './glb-viewer'

// URL取得やFileの選択は、呼び出し側の責務。
const response = await fetch('/scene.glb')
if (!response.ok) throw new Error('GLBを取得できませんでした。')
const asset = await parseProjectionGlb(await response.arrayBuffer())
world.add(asset.scene)

renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NoToneMapping
renderer.setOpaqueSort(projectionRenderSort(false))
renderer.setTransparentSort(projectionRenderSort(true))

asset.updateProjection()
const displayCamera = new THREE.PerspectiveCamera().copy(asset.camera, false)
asset.camera.matrixWorld.decompose(
  displayCamera.position, displayCamera.quaternion, displayCamera.scale,
)
// 表示用カメラだけを動かす。投影カメラasset.cameraは固定。
displayCamera.updateMatrixWorld(true)

// 毎フレーム、またはGLB全体の変換を変更した後。
asset.updateProjection()
renderer.render(world, displayCamera)

// 必要なら標準の近似表示へ切り替える。
asset.setMode('standard')
asset.setMode('tsl')

// 利用終了時。シーンを親から外し、読み込んだリソースと生成したTSLマテリアルを解放する。
asset.dispose()
```

`parseProjectionGlb`はTSLを適用した`LoadedProjectionAsset`を返す。初期化済みのレンダラーで`compileAsync`を呼ぶかどうかと、いつ既存表示を置き換えるかは呼び出し側が決める。読み込み・extras検証に失敗した場合はエラーを投げ、取得済みシーンのリソースを解放する。既定のLoaderは自己完結したGLBだけを許可し、外部画像・外部バッファへの参照を拒否する。必要に応じて`{ loader: configuredGLTFLoader }`でデコーダーやLoadingManagerを設定したLoaderを渡せる。

### 既存のGLTFLoaderへ組み込む場合

```ts
import { restoreProjectionAsset } from './glb-viewer'

const gltf = await myLoader.loadAsync('/scene.glb')
const projection = restoreProjectionAsset(gltf.scene)
projection.setMode('tsl')
world.add(gltf.scene)

// 更新と表示は上の例と同様。
projection.updateProjection()

// 元マテリアルへ戻し、このAPIが生成したTSLマテリアルだけを解放する。
projection.dispose()
// gltf.sceneと元のジオメトリ・マテリアル・テクスチャの解放は呼び出し側が担当する。
```

`restoreProjectionAsset`は借用したシーンを扱う`ProjectionAsset`を返し、既定では元マテリアルを維持する。`parseProjectionGlb`との違いはリソースの所有者と初期表示モード。どちらも`dispose()`は複数回呼べるが、解放後の`setMode()`・`updateProjection()`は使用できない。共有テクスチャなどを呼び出し側で管理する場合は、後者の借用APIを使う。
