import { ASSET_BASE_PATH } from "./config";

/** A listing photo's src: drafts hold data URLs; published photos are paths
 * under public/, which need the Pages base path in the static export. */
export function listingPhotoSrc(photo: string): string {
  return photo.startsWith("data:") ? photo : `${ASSET_BASE_PATH}/${photo}`;
}
