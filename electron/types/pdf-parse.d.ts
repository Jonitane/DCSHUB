declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParsePage {
    getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
  }

  interface PdfParseOptions {
    pagerender?: (page: PdfParsePage) => string | Promise<string>
    max?: number
  }

  function pdfParse(data: Buffer, options?: PdfParseOptions): Promise<{ numpages: number; text: string }>
  export default pdfParse
}
