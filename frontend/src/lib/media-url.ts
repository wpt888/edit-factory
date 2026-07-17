/** Return only the filename from POSIX or Windows paths received from the API. */
export function mediaFilename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export function segmentFileUrl(apiUrl: string, filePath: string) {
  return `${apiUrl}/segments/files/${encodeURIComponent(mediaFilename(filePath))}`;
}
