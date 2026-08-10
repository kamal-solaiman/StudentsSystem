/**
 * SVG QR Generator
 * No external libraries
 */
class QrSvgGenerator {
  static renderSvg(studentCode, size = 180) {
    const matrixSize = 11;
    const matrix = Array(matrixSize).fill(false).map(() => Array(matrixSize).fill(false));

    // Draw Corner Markers
    const addMarker = (row, col) => {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (row + r < matrixSize && col + c < matrixSize) {
            matrix[row + r][col + c] =
              r === 0 || r === 2 || c === 0 || c === 2 || (r === 1 && c === 1);
          }
        }
      }
    };

    addMarker(0, 0);
    addMarker(0, matrixSize - 3);
    addMarker(matrixSize - 3, 0);

    // Hash Student Code into deterministic bits
    let hash = 0;
    for (let i = 0; i < studentCode.length; i++) {
      hash = (hash << 5) - hash + studentCode.charCodeAt(i);
      hash |= 0;
    }

    for (let r = 3; r < matrixSize - 3; r++) {
      for (let c = 3; c < matrixSize - 3; c++) {
        matrix[r][c] = ((hash >> ((r * c) % 24)) & 1) === 1;
      }
    }

    // Center dot
    matrix[5][5] = true;
    matrix[4][5] = true;
    matrix[5][4] = true;

    // Generate SVG markup string
    let svgMarkup = `<svg viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; fill: #0f172a;">`;
    svgMarkup += `<rect width="110" height="110" fill="#ffffff" />`;

    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        if (matrix[r][c]) {
          const x = c * 10;
          const y = r * 10;
          svgMarkup += `<rect x="${x}" y="${y}" width="10" height="10" rx="1.5" />`;
        }
      }
    }

    svgMarkup += `</svg>`;
    return svgMarkup;
  }
}
