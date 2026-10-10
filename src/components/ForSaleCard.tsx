import type { SaleListing } from "@/lib/types";
import type { SellerContact } from "@/lib/seller";
import { formatNativeMoney, hostname } from "@/lib/format";
import { gradeInfo } from "@/lib/listing-text";
import { listingPhotoSrc } from "@/lib/listing-display";

/**
 * A published listing as buyers see it — on the For-sale page and on the
 * watch's own page, in both the local app and the Pages export. Prices are in
 * the listing's own currency: a buyer is quoted what you ask, not a USD
 * conversion. Reserved listings keep their details but drop the contact
 * button.
 */
export default function ForSaleCard({ title, listing, seller, headingLevel = 2 }: {
  title: string;
  listing: SaleListing;
  seller?: SellerContact;
  headingLevel?: 2 | 3;
}) {
  const grade = gradeInfo(listing.grade);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const reserved = listing.state === "reserved";
  const subject = encodeURIComponent(`Enquiry: ${title}`);

  return (
    <article className="card overflow-hidden" aria-label={`${title}, for sale`}>
      {listing.photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {listing.photos.map((photo, index) => (
            <li key={photo} className={index === 0 ? "col-span-2 row-span-2" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- static export serves these as plain files */}
              <img src={listingPhotoSrc(photo)} alt={`${title}, photo ${index + 1}`} className="aspect-square h-full w-full object-cover" loading={index === 0 ? "eager" : "lazy"} />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Heading className="text-lg font-semibold text-cocoa-950">{title}</Heading>
          <p className="text-2xl font-bold tabular-nums text-cocoa-950">{formatNativeMoney(listing.askingPrice)}</p>
        </div>
        {reserved && <p className="inline-block rounded-full bg-cocoa-900 px-3 py-1 text-xs font-semibold text-white">Reserved</p>}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {grade && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Condition</dt>
              <dd className="mt-1 text-cocoa-900"><span className="font-semibold">{grade.label}.</span> {grade.definition}{listing.conditionNotes && <span className="block text-cocoa-700">{listing.conditionNotes}</span>}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Included</dt>
            <dd className="mt-1 text-cocoa-900">{listing.included.length ? listing.included.join(", ") : "The watch only"}</dd>
          </div>
          {listing.serviceHistory && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-cocoa-500">Service</dt>
              <dd className="mt-1 text-cocoa-900">{listing.serviceHistory}</dd>
            </div>
          )}
        </dl>

        {listing.description && <p className="whitespace-pre-line text-sm text-cocoa-800">{listing.description}</p>}

        {listing.postings && listing.postings.some(posting => posting.url) && (
          <p className="text-sm text-cocoa-600">
            Also listed on{" "}
            {listing.postings.filter(posting => posting.url).map((posting, index, all) => (
              <span key={posting.url}>
                <a href={posting.url} className="font-medium text-azalea-700 hover:underline" rel="noopener noreferrer" target="_blank">{posting.platform || hostname(posting.url!)}</a>
                {index < all.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        )}

        {!reserved && seller && (
          <div className="flex flex-wrap items-center gap-3 border-t border-cocoa-100 pt-4">
            {seller.email && <a href={`mailto:${seller.email}?subject=${subject}`} className="btn-primary inline-flex min-h-11 items-center">Email {seller.name ?? "the seller"}</a>}
            {seller.paymentUrl && <a href={seller.paymentUrl} rel="noopener noreferrer" target="_blank" className="btn-secondary inline-flex min-h-11 items-center">{seller.paymentLabel ?? "Payment link"}</a>}
          </div>
        )}
        {!reserved && seller?.terms && <p className="text-xs text-cocoa-500">{seller.terms}</p>}
      </div>
    </article>
  );
}
