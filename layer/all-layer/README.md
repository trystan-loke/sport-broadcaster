npm install
npm install --os=linux --cpu=arm64 sharp

rm layer.zip
zip -r layer.zip node_modules package.json package-lock.json