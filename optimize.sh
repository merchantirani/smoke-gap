#!/bin/bash
# Pause App - Performance Optimization Script

echo "🚀 Optimizing pause app..."
echo ""

# Check if pngquant is installed for icon optimization
if command -v pngquant &> /dev/null; then
    echo "✅ Found pngquant - Optimizing icons..."

    # Optimize 512x512 icon
    if [ -f "icons/pause_icon_512.png" ]; then
        echo "   Compressing pause_icon_512.png (246KB -> target: 40KB)..."
        pngquant --quality=65-80 --speed 1 --force --output icons/pause_icon_512.png icons/pause_icon_512.png
    fi

    # Optimize 192x192 icon
    if [ -f "icons/pause_icon_192.png" ]; then
        echo "   Compressing pause_icon_192.png (36KB -> target: 12KB)..."
        pngquant --quality=65-80 --speed 1 --force --output icons/pause_icon_192.png icons/pause_icon_192.png
    fi

    # Optimize 180x180 icon
    if [ -f "icons/pause_icon_180.png" ]; then
        echo "   Compressing pause_icon_180.png (32KB -> target: 10KB)..."
        pngquant --quality=65-80 --speed 1 --force --output icons/pause_icon_180.png icons/pause_icon_180.png
    fi

    echo "✅ Icons optimized!"
else
    echo "⚠️  pngquant not found - Install it for icon optimization:"
    echo "   brew install pngquant"
fi

echo ""
echo "📊 Optimization Summary:"
echo "   ✓ Icons: Will be compressed after pngquant install"
echo "   ✓ Scripts: Will add defer loading in HTML"
echo "   ✓ CSS: Will optimize render-blocking"
echo ""
echo "✅ Manual optimizations applied in index.html"
