import { useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  gridSizes,
  gridSrc,
  gridSrcset,
  nextPhoto,
  opensViewer,
  photoCounter,
  previousPhoto,
  type GalleryPhoto,
} from "@/lib/offer-gallery";
import { cn } from "@/lib/utils";

interface Props {
  /** `galleryPhotos` results only: every URL already went through `safeHttpsUrl`, never the stored row. */
  photos: GalleryPhoto[];
  title: string;
  /** For the /dev kitchen sinks alone: the viewer is open on this photo (0-based) on the first render. */
  openAt?: number;
}

/**
 * The offer card's photo grid and the viewer it opens. The server renders the grid alone — every
 * photo a link to its large variant in a new tab — which is what a visitor without JavaScript gets.
 * A plain click of a photo opens the viewer on it instead; a modified or middle click keeps the
 * link's own action (`opensViewer`).
 *
 * The dialog has no trigger, so Radix has nothing to return the focus to: on close it goes back to
 * the photo that was clicked — the one the viewer opened on, not the one it shows at the end.
 */
export default function OfferPhotoViewer({ photos, title, openAt }: Props) {
  const total = photos.length;
  const [open, setOpen] = useState(openAt !== undefined);
  const [index, setIndex] = useState(openAt ?? 0);
  const openedFrom = useRef(openAt ?? 0);
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const sizes = gridSizes(total);
  // `.at` keeps `undefined` in the type: an island mounted with no photos renders the grid alone.
  const shown = photos.at(index) ?? photos.at(0);

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, at: number) {
    if (!opensViewer(event.nativeEvent)) return;
    event.preventDefault();
    openedFrom.current = at;
    setIndex(at);
    setOpen(true);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setIndex((current) => nextPhoto(current, total));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setIndex((current) => previousPhoto(current, total));
    }
  }

  function handleCloseAutoFocus(event: Event) {
    event.preventDefault();
    links.current[openedFrom.current]?.focus();
  }

  return (
    <>
      <ul className={cn("grid gap-3", total === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
        {photos.map((photo, at) => (
          <li key={at}>
            <a
              ref={(element) => {
                links.current[at] = element;
              }}
              href={photo.large}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                handleClick(event, at);
              }}
              className="border-border focus-visible:ring-ring/50 block overflow-hidden rounded-lg border transition-[opacity,box-shadow] outline-none hover:opacity-80 focus-visible:ring-[3px]"
            >
              <img
                src={gridSrc(photo)}
                srcSet={gridSrcset(photo)}
                sizes={sizes}
                alt={`Zdjęcie ${at + 1} z ${total}: ${title}`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="aspect-[4/3] w-full object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
      {shown !== undefined && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            aria-describedby={undefined}
            onKeyDown={handleKeyDown}
            onCloseAutoFocus={handleCloseAutoFocus}
            className="bg-card text-card-foreground pt-12 sm:max-w-5xl"
          >
            <DialogTitle className="sr-only">Zdjęcia: {title}</DialogTitle>
            <img
              src={shown.large}
              alt={`Zdjęcie ${index + 1} z ${total}: ${title}`}
              decoding="async"
              referrerPolicy="no-referrer"
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
            <div className="flex items-center justify-center gap-4">
              {total > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Poprzednie zdjęcie"
                  onClick={() => {
                    setIndex((current) => previousPhoto(current, total));
                  }}
                >
                  <ChevronLeftIcon />
                </Button>
              )}
              <p aria-live="polite" className="text-muted-foreground min-w-16 text-center text-sm tabular-nums">
                {photoCounter(index, total)}
              </p>
              {total > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Następne zdjęcie"
                  onClick={() => {
                    setIndex((current) => nextPhoto(current, total));
                  }}
                >
                  <ChevronRightIcon />
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
