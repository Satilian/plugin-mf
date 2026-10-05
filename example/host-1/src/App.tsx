import "./App.css";
import { Div } from "./div/div";
import { P } from "./p";

const App = () => {
  return (
    <div className="content">
      <h1>Host 1</h1>
      <P text="Hello, this is a paragraph." />
      <Div>Div component content</Div>
    </div>
  );
};

export default App;
