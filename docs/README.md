# three-layered-scene-editor

レイヤー画像をPlaneへ配置し、カメラの視差で2.5D表現を作るツール。

| やりたいこと | 読む場所 |
| --- | --- |
| 起動して画像を配置・保存する | [エディターの操作](./minimal-implementation.md) |
| GLBを別プロジェクトで表示する | [最小限の使用例](./glb-projection.md#別プロジェクトでの最小限の使用例) |
| 座標・FOV・保存形式を確認する | [仕様](./specification.md) |
| GLBの投影用extrasを確認する | [extras v1の仕様](./glb-projection.md#extras-v1の仕様) |

JSONは再編集用、GLBは表示用の成果物。別プロジェクトでの投影表示には`src/glb-projection.ts`の1ファイルを使う。

開発時の確認は`npm test`、型チェックとビルドは`npm run build`。ブラウザー確認は明示的な依頼がある場合に実施する。
