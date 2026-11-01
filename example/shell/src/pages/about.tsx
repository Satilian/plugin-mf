import { Link } from "@satilian/router";
import Div from "host1/Div";
import Section from "host2/Section";
import { RemoteBoundary } from "../remote-boundary";
import { preloadPage } from "./preload";

export const AboutPage = () => {
  return (
    <div>
      <h1>About Page</h1>

      <Link to="/" onMouseEnter={() => preloadPage("home")} onFocus={() => preloadPage("home")}>Home Page</Link>
      <RemoteBoundary name="host2/Section">
        <Section>
          <RemoteBoundary name="host1/Div">
            <Div>This is the about page.</Div>
          </RemoteBoundary>
        </Section>
      </RemoteBoundary>
    </div>
  );
};
