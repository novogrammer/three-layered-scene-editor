# GLBからの投影表示の復元

GLBは利用側へ渡す単一の成果物とする。編集JSONは復元に不要。一般的なGLBビューアーは標準マテリアルと頂点UVで近似表示し、専用表示側はGLB内のカメラ・画像・extrasを使って投影表示を復元する。独立した読み込み側の実装は`src/viewer.ts`、表示ページは`viewer.html`。

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

`src/viewer.ts`のimport先はThree.jsとそのaddonsだけ。編集モデル、エディターのTSL実装、extras型定義、画像ファイル、編集JSONには依存せず、読み込み側に必要な型・検証・投影処理を独立して持つ。これは利用側としてGLBの契約を検証するための分離であり、同じViteプロジェクトでビルドすることとは区別する。

自動テストでは実際のGLB出力をGLTFLoaderで読み戻し、独立した復元APIへ渡す。テスト中の画像デコードは置き換え、画像参照・座標・extras・表示モードの切り替え・不正データの拒否を確認する。GPUでの見た目とブラウザー操作の確認は未実施。
