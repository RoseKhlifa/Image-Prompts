declare module "react-masonry-css" {
  import type { ReactNode } from "react";

  export interface MasonryProps {
    breakpointCols?: number | { default: number; [key: number]: number };
    columnClassName?: string;
    className?: string;
    children?: ReactNode;
  }

  const Masonry: (props: MasonryProps) => JSX.Element;
  export default Masonry;
}
