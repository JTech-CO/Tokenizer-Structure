# Vendored Transformers.js

이 디렉터리는 브라우저가 실행 시점에 원격 JavaScript를 가져오지 않도록
`@huggingface/transformers` 3.8.1의 공식 npm 브라우저 번들을 고정합니다.

- 출처, npm integrity, 파일 SHA-256은 `manifest.json`에 기록합니다.
- 원본 Apache-2.0 라이선스는 `HUGGINGFACE-TRANSFORMERS-LICENSE`에 보존합니다.
- 현재 애플리케이션은 `AutoTokenizer`만 사용하므로 ONNX/WASM 파일은 배포하지 않습니다.
- 추후 모델 추론을 추가한다면 동일 릴리스의 WASM 자산을 별도로 고정하고 CSP·무결성 검증을 다시 수행해야 합니다.

이 파일은 직접 수정하지 않고 정확한 npm 릴리스에서 다시 생성합니다.
