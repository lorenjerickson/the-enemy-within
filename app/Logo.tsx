import Image from "next/image";

const LOGOS = {
  square: { src: "/assets/images/tew-logo-square.png", ratio: 1254 / 1254 },
  wide: { src: "/assets/images/tew-logo-wide.png", ratio: 1962 / 802 },
};

/**
 * The campaign's logo: square (beside forms) or wide (banners, the header). `width` is the widest it's shown, in CSS
 * pixels (the image is served at that size, not the 2 MB original); className can shrink it.
 */
export default function Logo({ variant, width, className = "", priority = false }: { variant: keyof typeof LOGOS; width: number; className?: string; priority?: boolean }) {
  const { src, ratio } = LOGOS[variant];
  return <Image src={src} width={width} height={Math.round(width / ratio)} alt="The Enemy Within" className={className} priority={priority} />;
}
