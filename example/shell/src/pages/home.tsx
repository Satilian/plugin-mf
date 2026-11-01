import { Link } from "@satilian/router";
import P from "host1/P";
import Span from "host2/Span";
import Section from "host2/Section";
import { RemoteBoundary } from "../remote-boundary";
import { preloadPage } from "./preload";

export const HomePage = () => {
  return (
    <div>
      <h1>Home Page</h1>

      <Link to="/about" onMouseEnter={() => preloadPage("about")} onFocus={() => preloadPage("about")}>About Page</Link>
      <RemoteBoundary name="host2/Section">
        <Section>
          <RemoteBoundary name="host1/P">
            <P text="Welcome to the home page." />
          </RemoteBoundary>
        </Section>
      </RemoteBoundary>
      <RemoteBoundary name="host2/Span">
        <Span />
      </RemoteBoundary>
    </div>
  );
};
