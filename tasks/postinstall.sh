#!/bin/sh
# Install python deps
cd gofbot; pip install -r requirements.txt
# Install 'client' side deps
cd ../app; npm install
echo "# Install complete\n# To run use:\n   npm run dev"