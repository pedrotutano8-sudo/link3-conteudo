FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fontconfig poppler-utils ca-certificates curl bzip2 chromium && rm -rf /var/lib/apt/lists/*
# Parakeet (NVIDIA, CC-BY-4.0): transcrição local, o mesmo modelo do kit Edição Sem Editor (~650 MB, fica em cache no build)
RUN mkdir -p /models && curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 \
    | tar xj -C /models && mv /models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 /models/parakeet && rm -rf /models/parakeet/test_wavs
# Robust Video Matting (GPL-3.0): recorta a pessoa para as palavras-chave passarem atrás dela (~15 MB)
RUN mkdir -p /models/rvm && curl -fsSL -o /models/rvm/rvm_mobilenetv3_fp32.onnx https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx
WORKDIR /app
COPY package*.json ./
# onnxruntime-node: só CPU (não baixa as bibliotecas de GPU no build)
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci --omit=dev && rm -rf node_modules/onnxruntime-node/bin/napi-v*/darwin node_modules/onnxruntime-node/bin/napi-v*/win32
COPY . .
ENV WORK_DIR=/work NODE_ENV=production PARAKEET_DIR=/models/parakeet CHROME_BIN=/usr/bin/chromium MARCAS_DIR=/marcas
CMD ["node", "index.js"]
